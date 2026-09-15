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
let loadedModelId: string | null = null;
let currentTileSize = 128;

async function determineOptimalTileSize(): Promise<number> {
  if (!navigator.gpu) return 128; // Fallback a CPU/WASM seguro

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 128;

    // Convertimos el límite de binding a Megabytes
    const maxBufferMB = adapter.limits.maxStorageBufferBindingSize / (1024 * 1024);
    
    // Información descriptiva (ej. "NVIDIA GeForce GTX 1060 6GB", "Apple M2", etc.)
    const info = await adapter.requestAdapterInfo();
    const gpuName = info.description.toLowerCase();

    // Si es una gráfica dedicada potente o tiene un buffer enorme
    if (maxBufferMB >= 1024 || gpuName.includes('nvidia') || gpuName.includes('rtx') || gpuName.includes('rx ')) {
      return 256; 
    }

    return 128; // Gráficas integradas o móviles
  } catch (e) {
    return 128; // Si falla la consulta, nos curamos en salud
  }
}

const MODEL_URLS: Record<string, string> = {
  'real-esrgan-x4plus': 'https://huggingface.co/KingPro100/real-esrgan-onxx/resolve/main/Real-ESRGAN-x4plus.onnx',
  'realesr-general-x4v3': 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx',
  'realesrgan-anime': 'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx'
};

async function getSession(modelId: string = 'real-esrgan-x4plus') {
  if (loadedModelId !== modelId) {
    sessionPromise = null;
    initialized = false;
  }

  if (!sessionPromise) {
    sessionPromise = new Promise(async (resolve, reject) => {
      loadedModelId = modelId;
      const modelUrl = MODEL_URLS[modelId] || MODEL_URLS['real-esrgan-x4plus'];
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

      console.log(`[Worker] Initializing ONNX session with device: ${currentDevice}`);
      
      self.postMessage({
        type: 'status',
        status: 'loading-model',
        message: isWebGPUSupported ? "Loading Real-ESRGAN model (WebGPU)..." : "Loading Real-ESRGAN model (CPU)...",
      });

      self.postMessage({
        type: 'model-progress',
        progress: 0,
        phase: `Connecting to download model...`
      });

      try {
        // Download manually to provide real progress updates
        const response = await fetch(modelUrl);
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
                if (progress > lastProgress + 2) {
                  lastProgress = progress;
                  self.postMessage({
                    type: 'model-progress',
                    progress: progress,
                    phase: `Downloading Real-ESRGAN model (${currentDevice})...`
                  });
                }
              }
            }
          }
        }
        
        self.postMessage({
          type: 'model-progress',
          progress: 100,
          phase: `Initializing on GPU. This may take a few seconds...`
        });
        
        // Assemble chunks
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

        let session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: [currentDevice],
          graphOptimizationLevel: 'all'
        });
        
        if (currentDevice === 'webgpu') {
          currentTileSize = await determineOptimalTileSize();
          try {
            self.postMessage({
              type: 'model-progress',
              progress: 100,
              phase: `Warming up WebGPU with ${currentTileSize}x${currentTileSize} tile...`
            });
            const dummyArray = new Float32Array(1 * 3 * currentTileSize * currentTileSize);
            const dummyInput = new ort.Tensor('float32', dummyArray, [1, 3, currentTileSize, currentTileSize]);
            const inputName = session.inputNames[0];
            await session.run({ [inputName]: dummyInput });
            console.log(`[Worker] Warm-up exitoso a ${currentTileSize}x${currentTileSize}`);
          } catch (error) {
            console.warn(`[Worker] Fallo de memoria en ${currentTileSize}x${currentTileSize}. Haciendo fallback a 128x128.`);
            await session.release(); 
            session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ['webgpu'] });
            currentTileSize = 128; 
          }
        } else {
          currentTileSize = 128;
        }

        self.postMessage({
          type: 'model-progress',
          progress: 100,
          phase: `Real-ESRGAN model ready (${currentDevice})`
        });

        console.log(`[Worker] Model loaded successfully using ${currentDevice}!`);
        resolve(session);
      } catch (error: any) {
        console.error(`[Worker] Error loading model with ${currentDevice}:`, error);
        
        // Fallback to WASM if WebGPU fails
        if (currentDevice === 'webgpu') {
          try {
             currentDevice = 'wasm';
             console.log("[Worker] Falling back to WASM.");
             self.postMessage({
               type: 'model-progress',
               progress: 100,
               phase: `GPU initialization failed. Falling back to CPU (slower)...`
             });
             const fallbackSession = await ort.InferenceSession.create(modelUrl, {
               executionProviders: ['wasm'],
               graphOptimizationLevel: 'all'
             });
             resolve(fallbackSession);
             return;
          } catch(e) {
             reject(new Error(`Could not load model. Details: ${error?.message || error}`));
          }
        } else {
          reject(new Error(`Could not load model. Details: ${error?.message || error}`));
        }
      }
    });
  }
  return sessionPromise;
}

async function initUpscaler(modelId?: string): Promise<void> {
  if (initialized && (!modelId || loadedModelId === modelId)) {
    return;
  }

  try {
    await getSession(modelId);
    initialized = true;
    self.postMessage({
      type: 'status',
      status: 'ready',
      message: `Real-ESRGAN model ready to process (${currentDevice}).`,
    });
  } catch (error: any) {
    console.error('[Worker] Error during init:', error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: error?.message || 'Error initializing model. Check console.',
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

async function upscaleImage(imageData: ImageData, modelId?: string): Promise<ImageData> {
  const session = await getSession(modelId);
  
  const width = imageData.width;
  const height = imageData.height;
  const numChannels = 3; // RGB
  
  const TILE_SIZE = currentTileSize;
  const SCALE = 4;
  const OUT_TILE_SIZE = TILE_SIZE * SCALE; 
  const OVERLAP = 32; // Overlap constante de 32 píxels
  const STEP = TILE_SIZE - OVERLAP; 
  const BLEND_RADIUS = OVERLAP * SCALE; // Radio de fusión en la salida
  
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
        phase: `Processing: ${processedTiles}/${totalTiles} tiles (${currentDevice})`
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
      await initUpscaler(message.modelId);
    } catch (error: any) {
      console.error('[Worker] Error during init:', error);
      self.postMessage({
        type: 'status',
        status: 'error',
        message: error?.message || 'An error occurred while initializing AI model.',
      });
    }
    return;
  }

  if (message.type === 'process-image') {
    const { id, imageData, modelId } = message;

    self.postMessage({
      type: 'processing',
      id,
      status: 'started',
    });

    try {
      await initUpscaler(modelId);

      const output = await upscaleImage(imageData, modelId);

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
      console.error('[Worker] Error during process-image:', error);
      self.postMessage({
        type: 'error',
        id,
        message: error?.message || 'AI failed to process this image.',
      });
    }
  } 
};