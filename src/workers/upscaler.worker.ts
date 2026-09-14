import * as ort from 'onnxruntime-web/webgpu';

// Re-export types for main thread to import
export type {
  WorkerInitMessage,
  WorkerProcessMessage,
  WorkerIncomingMessage,
  WorkerStatusMessage,
  WorkerModelProgressMessage,
  WorkerResultMessage,
  WorkerProcessingMessage,
  WorkerErrorMessage,
  WorkerOutgoingMessage,
} from './upscaler.types';

declare const self: Worker;

interface PostableMessage {
  type: string;
  [key: string]: any;
}

// Config ONNX runtime
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

let initialized = false;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let currentDevice = 'wasm'; 

// Utilitzem un model Real-ESRGAN x4 en format ONNX publicat a HuggingFace
const MODEL_URL = 'https://huggingface.co/KingPro100/real-esrgan-onxx/resolve/main/Real-ESRGAN-x4plus.onnx';

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = new Promise(async (resolve, reject) => {
      let isWebGPUSupported = false;
      try {
        if (navigator.gpu) {
          // @ts-ignore
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            isWebGPUSupported = true;
          }
        }
      } catch (e) {
        console.warn("[Worker] Error checking WebGPU adapter:", e);
      }

      currentDevice = isWebGPUSupported ? 'webgpu' : 'wasm';

      console.log(`[Worker] Initializing ONNX session amb el dispositiu: ${currentDevice}`);
      
      self.postMessage({
        type: 'status',
        status: 'loading-model',
        message: isWebGPUSupported ? "Carregant model Real-ESRGAN (WebGPU)..." : "Carregant model Real-ESRGAN (CPU)...",
      });

      self.postMessage({
        type: 'model-progress',
        progress: 0,
        phase: `Connectant per descarregar el model...`
      });

      try {
        // Descarregar manualment per tenir una barra de progrés real
        const response = await fetch(MODEL_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        let loaded = 0;
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        
        let lastProgress = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              loaded += value.length;
              if (total > 0) {
                const progress = Math.round((loaded / total) * 100);
                if (progress > lastProgress + 2) { // Refrescar cada 2% per no saturar
                  lastProgress = progress;
                  self.postMessage({
                    type: 'model-progress',
                    progress: progress,
                    phase: `Descarregant model Real-ESRGAN (${currentDevice})...`
                  });
                }
              }
            }
          }
        }
        
        self.postMessage({
          type: 'model-progress',
          progress: 100,
          phase: `Inicialitzant a la GPU. Això pot tardar uns segons...`
        });
        
        // Juntar els chunks
        let modelBuffer: ArrayBuffer;
        if (chunks.length > 0) {
          const arrayBuffer = new Uint8Array(loaded);
          let offset = 0;
          for (const chunk of chunks) {
            arrayBuffer.set(chunk, offset);
            offset += chunk.length;
          }
          modelBuffer = arrayBuffer.buffer;
        } else {
          modelBuffer = await response.arrayBuffer();
        }

        const session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: [currentDevice],
          graphOptimizationLevel: 'all'
        });
        
        self.postMessage({
          type: 'model-progress',
          progress: 100,
          phase: `Model Real-ESRGAN preparat (${currentDevice})`
        });

        console.log(`[Worker] Model carregat correctament utilitzant ${currentDevice}!`);
        resolve(session);
      } catch (error: any) {
        console.error(`[Worker] Error crític carregant el model amb ${currentDevice}:`, error);
        
        // Fallback a WASM si WebGPU falla
        if (currentDevice === 'webgpu') {
          try {
             currentDevice = 'wasm';
             console.log("[Worker] Fent fallback a WASM.");
             self.postMessage({
               type: 'model-progress',
               progress: 100,
               phase: `La targeta gràfica ha fallat. Utilitzant CPU (més lent)...`
             });
             const fallbackSession = await ort.InferenceSession.create(MODEL_URL, {
               executionProviders: ['wasm'],
               graphOptimizationLevel: 'all'
             });
             resolve(fallbackSession);
             return;
          } catch(e) {
             reject(new Error(`No s'ha pogut carregar el model. Detall: ${error?.message || error}`));
          }
        } else {
          reject(new Error(`No s'ha pogut carregar el model. Detall: ${error?.message || error}`));
        }
      }
    });
  }
  return sessionPromise;
}

async function initUpscaler(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    await getSession();
    initialized = true;
    self.postMessage({
      type: 'status',
      status: 'ready',
      message: `Model Real-ESRGAN a punt per processar (${currentDevice}).`,
    });
  } catch (error: any) {
    console.error('[Worker] Error en la inicialització:', error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: error?.message || 'Error en inicialitzar el model. Revisa la consola.',
    });
  }
}

async function upscaleImage(imageData: ImageData): Promise<ImageData> {
  const session = await getSession();
  
  const width = imageData.width;
  const height = imageData.height;
  const numChannels = 3; // RGB
  
  const TILE_SIZE = 128;
  const SCALE = 4;
  const OUT_TILE_SIZE = TILE_SIZE * SCALE;
  
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;
  const outClampedData = new Uint8ClampedArray(outWidth * outHeight * 4);
  
  const numTilesX = Math.ceil(width / TILE_SIZE);
  const numTilesY = Math.ceil(height / TILE_SIZE);
  const totalTiles = numTilesX * numTilesY;
  
  let processedTiles = 0;
  
  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const tileFloat32Data = new Float32Array(1 * numChannels * TILE_SIZE * TILE_SIZE);
      
      const startX = tx * TILE_SIZE;
      const startY = ty * TILE_SIZE;
      
      // Extreure el tile (omplint amb 0 si ens passem de la imatge)
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const imgY = startY + y;
          const imgX = startX + x;
          
          let r = 0, g = 0, b = 0;
          if (imgX < width && imgY < height) {
            const srcIndex = (imgY * width + imgX) * 4;
            r = imageData.data[srcIndex] / 255.0;
            g = imageData.data[srcIndex + 1] / 255.0;
            b = imageData.data[srcIndex + 2] / 255.0;
          }
          
          const dstIndexR = 0 * (TILE_SIZE * TILE_SIZE) + y * TILE_SIZE + x;
          const dstIndexG = 1 * (TILE_SIZE * TILE_SIZE) + y * TILE_SIZE + x;
          const dstIndexB = 2 * (TILE_SIZE * TILE_SIZE) + y * TILE_SIZE + x;
          
          tileFloat32Data[dstIndexR] = r;
          tileFloat32Data[dstIndexG] = g;
          tileFloat32Data[dstIndexB] = b;
        }
      }
      
      const inputTensor = new ort.Tensor('float32', tileFloat32Data, [1, 3, TILE_SIZE, TILE_SIZE]);
      
      const feeds: Record<string, ort.Tensor> = {};
      feeds[session.inputNames[0]] = inputTensor;
      
      // Executar el model només pel tile
      const results = await session.run(feeds);
      const outputTensor = results[session.outputNames[0]];
      const outFloat32Data = outputTensor.data as Float32Array;
      
      // Col·locar el tile de sortida a la imatge final
      for (let y = 0; y < OUT_TILE_SIZE; y++) {
        for (let x = 0; x < OUT_TILE_SIZE; x++) {
          const outImgY = startY * SCALE + y;
          const outImgX = startX * SCALE + x;
          
          if (outImgX < outWidth && outImgY < outHeight) {
            const rIndex = 0 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + y * OUT_TILE_SIZE + x;
            const gIndex = 1 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + y * OUT_TILE_SIZE + x;
            const bIndex = 2 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + y * OUT_TILE_SIZE + x;
            
            let r = outFloat32Data[rIndex] * 255.0;
            let g = outFloat32Data[gIndex] * 255.0;
            let b = outFloat32Data[bIndex] * 255.0;
            
            r = Math.max(0, Math.min(255, Math.round(r)));
            g = Math.max(0, Math.min(255, Math.round(g)));
            b = Math.max(0, Math.min(255, Math.round(b)));
            
            const dstIndex = (outImgY * outWidth + outImgX) * 4;
            outClampedData[dstIndex] = r;
            outClampedData[dstIndex + 1] = g;
            outClampedData[dstIndex + 2] = b;
            outClampedData[dstIndex + 3] = 255;
          }
        }
      }
      
      processedTiles++;
      self.postMessage({
        type: 'process-progress',
        progress: Math.round((processedTiles / totalTiles) * 100),
        phase: `Processant: ${processedTiles}/${totalTiles} blocs (${currentDevice})`
      });
    }
  }
  
  return new ImageData(outClampedData, outWidth, outHeight);
}

self.onmessage = async (event: MessageEvent<PostableMessage>) => {
  const message = event.data;

  if (message.type === 'reset') {
    initialized = false;
    return;
  }

  if (message.type === 'init') {
    try {
      await initUpscaler();
    } catch (error: any) {
      console.error('[Worker] Error en init:', error);
      self.postMessage({
        type: 'status',
        status: 'error',
        message: error?.message || "S'ha produït un error en inicialitzar el model d'IA.",
      });
    }
    return;
  }

  if (message.type === 'process-image') {
    const { id, imageData } = message;

    self.postMessage({
      type: 'processing',
      id,
      status: 'started',
    });

    try {
      await initUpscaler();

      const output = await upscaleImage(imageData);

      self.postMessage({
        type: 'result',
        id,
        imageData: output,
      });

      self.postMessage({
        type: 'processing',
        id,
        status: 'finished',
      });
    } catch (error: any) {
      console.error('[Worker] Error en process-image:', error);
      self.postMessage({
        type: 'error',
        id,
        message: error?.message || "L'IA ha fallat en processar aquesta imatge.",
      });
    }
  } 
};