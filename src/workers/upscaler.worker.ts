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

function getTileCoords(length: number, tileSize: number, step: number): number[] {
  if (length <= tileSize) {
    return [0];
  }
  const coords: number[] = [];
  for (let pos = 0; pos < length - tileSize; pos += step) {
    coords.push(pos);
  }
  const lastPos = length - tileSize;
  if (coords.length === 0 || coords[coords.length - 1] !== lastPos) {
    coords.push(lastPos);
  }
  return coords;
}

function getWeight1D(
  pos: number,
  size: number,
  isStartEdge: boolean,
  isEndEdge: boolean,
  blendRadius: number
): number {
  let w = 1.0;
  if (!isStartEdge && pos < blendRadius) {
    w = Math.min(w, 0.5 * (1 - Math.cos((Math.PI * pos) / blendRadius)));
  }
  if (!isEndEdge && pos >= size - blendRadius) {
    const dist = size - 1 - pos;
    w = Math.min(w, 0.5 * (1 - Math.cos((Math.PI * dist) / blendRadius)));
  }
  return w;
}

async function upscaleImage(imageData: ImageData): Promise<ImageData> {
  const session = await getSession();
  
  const width = imageData.width;
  const height = imageData.height;
  const numChannels = 3; // RGB
  
  const TILE_SIZE = 128;
  const SCALE = 4;
  const OUT_TILE_SIZE = TILE_SIZE * SCALE; // 512
  const OVERLAP = 32; // Overlap de 32 píxels d'entrada per eliminar completament els talls
  const STEP = TILE_SIZE - OVERLAP; // 96
  const BLEND_RADIUS = OVERLAP * SCALE; // 128 píxels de transició suau en la sortida
  
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;
  const totalPixels = outWidth * outHeight;
  
  const outAccumR = new Float32Array(totalPixels);
  const outAccumG = new Float32Array(totalPixels);
  const outAccumB = new Float32Array(totalPixels);
  const outWeights = new Float32Array(totalPixels);
  const outClampedData = new Uint8ClampedArray(totalPixels * 4);
  
  const xCoords = getTileCoords(width, TILE_SIZE, STEP);
  const yCoords = getTileCoords(height, TILE_SIZE, STEP);
  const totalTiles = xCoords.length * yCoords.length;
  
  let processedTiles = 0;
  
  for (const startY of yCoords) {
    const isTopEdge = startY === 0;
    const isBottomEdge = startY + TILE_SIZE >= height;
    
    // Precalcular pesos verticals per la fila
    const weightsY = new Float32Array(OUT_TILE_SIZE);
    for (let y = 0; y < OUT_TILE_SIZE; y++) {
      weightsY[y] = getWeight1D(y, OUT_TILE_SIZE, isTopEdge, isBottomEdge, BLEND_RADIUS);
    }

    for (const startX of xCoords) {
      const isLeftEdge = startX === 0;
      const isRightEdge = startX + TILE_SIZE >= width;
      
      // Precalcular pesos horitzontals per la columna
      const weightsX = new Float32Array(OUT_TILE_SIZE);
      for (let x = 0; x < OUT_TILE_SIZE; x++) {
        weightsX[x] = getWeight1D(x, OUT_TILE_SIZE, isLeftEdge, isRightEdge, BLEND_RADIUS);
      }

      const tileFloat32Data = new Float32Array(1 * numChannels * TILE_SIZE * TILE_SIZE);
      
      // Extreure el tile amb clamp (replicate padding) per no generar línies negres a les vores
      for (let y = 0; y < TILE_SIZE; y++) {
        const clampedY = Math.min(height - 1, Math.max(0, startY + y));
        const srcRowOffset = clampedY * width;
        const tileRowOffset = y * TILE_SIZE;
        
        for (let x = 0; x < TILE_SIZE; x++) {
          const clampedX = Math.min(width - 1, Math.max(0, startX + x));
          const srcIndex = (srcRowOffset + clampedX) * 4;
          
          const r = imageData.data[srcIndex] / 255.0;
          const g = imageData.data[srcIndex + 1] / 255.0;
          const b = imageData.data[srcIndex + 2] / 255.0;
          
          tileFloat32Data[0 * (TILE_SIZE * TILE_SIZE) + tileRowOffset + x] = r;
          tileFloat32Data[1 * (TILE_SIZE * TILE_SIZE) + tileRowOffset + x] = g;
          tileFloat32Data[2 * (TILE_SIZE * TILE_SIZE) + tileRowOffset + x] = b;
        }
      }
      
      const inputTensor = new ort.Tensor('float32', tileFloat32Data, [1, 3, TILE_SIZE, TILE_SIZE]);
      
      const feeds: Record<string, ort.Tensor> = {};
      feeds[session.inputNames[0]] = inputTensor;
      
      const results = await session.run(feeds);
      const outputTensor = results[session.outputNames[0]];
      const outFloat32Data = outputTensor.data as Float32Array;
      
      // Acumular el resultat amb barreja sinusoidal suau (sense costures)
      const tileWOut = Math.min(OUT_TILE_SIZE, outWidth - startX * SCALE);
      const tileHOut = Math.min(OUT_TILE_SIZE, outHeight - startY * SCALE);
      
      for (let y = 0; y < tileHOut; y++) {
        const wy = weightsY[y];
        if (wy <= 0) continue;
        
        const outY = startY * SCALE + y;
        const rowOffset = outY * outWidth;
        const tileRowOffset = y * OUT_TILE_SIZE;
        
        for (let x = 0; x < tileWOut; x++) {
          const w = wy * weightsX[x];
          if (w <= 0) continue;
          
          const outX = startX * SCALE + x;
          const dstIndex = rowOffset + outX;
          
          const rIndex = 0 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + tileRowOffset + x;
          const gIndex = 1 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + tileRowOffset + x;
          const bIndex = 2 * (OUT_TILE_SIZE * OUT_TILE_SIZE) + tileRowOffset + x;
          
          outAccumR[dstIndex] += outFloat32Data[rIndex] * w;
          outAccumG[dstIndex] += outFloat32Data[gIndex] * w;
          outAccumB[dstIndex] += outFloat32Data[bIndex] * w;
          outWeights[dstIndex] += w;
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
  
  // Normalitzar cada píxel per la suma dels seus pesos (fusió perfecta)
  for (let i = 0; i < totalPixels; i++) {
    const w = outWeights[i];
    const invW = w > 0 ? 1.0 / w : 1.0;
    
    const r = Math.round(outAccumR[i] * invW * 255.0);
    const g = Math.round(outAccumG[i] * invW * 255.0);
    const b = Math.round(outAccumB[i] * invW * 255.0);
    
    const dst = i * 4;
    outClampedData[dst] = Math.max(0, Math.min(255, r));
    outClampedData[dst + 1] = Math.max(0, Math.min(255, g));
    outClampedData[dst + 2] = Math.max(0, Math.min(255, b));
    outClampedData[dst + 3] = 255;
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