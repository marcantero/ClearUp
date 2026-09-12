import { pipeline, RawImage, env } from '@huggingface/transformers';

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
} from './backgroundRemover.types';

declare const self: Worker;

interface PostableMessage {
  type: string;
  [key: string]: any;
}

// Optional: Configure environment for production
env.allowLocalModels = false;

let initialized = false;
let segmenterPromise: Promise<any> | null = null;
let currentDevice = 'wasm'; // Track which mode we're using

// Helper function to handle progress messages
function handleProgress(data: any) {
  if (data.status === 'progress') {
    self.postMessage({
      type: 'model-progress',
      progress: Math.round(data.progress),
      phase: data.file ? `Downloading: ${data.file} (${currentDevice})` : `Preparing model (${currentDevice})...`
    });
  } else if (data.status === 'ready') {
    self.postMessage({
      type: 'model-progress',
      progress: 100,
      phase: `Model RMBG-1.4 loaded and ready (${currentDevice})`
    });
  }
}

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = new Promise(async (resolve, reject) => {
      // 1. Check if WebGPU is REALLY available before initializing AI
      let isWebGPUSupported = false;
      try {
        // @ts-ignore - navigator.gpu might not be strictly typed in older TS configs
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
      // If we're in WASM (CPU), use 'q8' (quantized to 8 bits) to avoid hanging the tab
      const dtype = isWebGPUSupported ? 'fp32' : 'q8'; 

      console.log(`[Worker] Initializing pipeline with device: ${currentDevice} and precision: ${dtype}`);
      
      self.postMessage({
        type: 'status',
        status: 'loading-model',
        message: isWebGPUSupported 
          ? "Loading high-precision model (WebGPU)..." 
          : "WebGPU not detected. Loading CPU mode (WASM)...",
      });

      try {
        // 2. Call the pipeline once using the safe method
        const pipe = await pipeline('background-removal', 'briaai/RMBG-1.4', {
          device: currentDevice as any,
          dtype: dtype as any,
          progress_callback: handleProgress
        });
        
        console.log(`[Worker] Model successfully loaded using ${currentDevice}!`);
        resolve(pipe);
      } catch (error: any) {
        console.error(`[Worker] Critical error loading model with ${currentDevice}:`, error);
        reject(new Error(`Could not load the model. Detail: ${error?.message || error}`));
      }
    });
  }
  return segmenterPromise;
}

async function initBackgroundRemover(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    self.postMessage({
      type: 'status',
      status: 'loading-model',
      message: "Initializing RMBG-1.4 model...",
    });

    await getSegmenter();

    initialized = true;
    self.postMessage({
      type: 'status',
      status: 'ready',
      message: `Model RMBG-1.4 ready to process (${currentDevice}).`,
    });
  } catch (error: any) {
    console.error('[Worker] Error during initialization:', error);
    self.postMessage({
      type: 'status',
      status: 'error',
      message: error?.message || 'Error during model initialization. Check console.',
    });
  }
}

async function removeBackgroundWithRMBG(imageData: ImageData): Promise<ImageData> {
  const { width, height, data } = imageData;
  const segmenter = await getSegmenter();
  
  // Transformers.js v3 requires RawImage
  const imageToProcess = new RawImage(imageData.data, imageData.width, imageData.height, 4);
  
  // Execute the pipeline
  const outputs = await segmenter(imageToProcess);
  
  // Output can be an array or an object. Make sure we get the mask.
  const finalMask = Array.isArray(outputs) ? outputs[0] : outputs;

  // Get the mask blob
  const maskBlob: Blob | null = await finalMask.toBlob();
  if (!maskBlob) {
    throw new Error('Failed to create mask blob from RMBG output.');
  }

  // 1. Create Bitmaps for both the original image and the mask
  // We need a blob for the original image first
  const originalCanvas = new OffscreenCanvas(width, height);
  const originalCtx = originalCanvas.getContext('2d');
  if (!originalCtx) throw new Error('Failed to create 2D context.');
  originalCtx.putImageData(imageData, 0, 0);
  const originalBlob = await originalCanvas.convertToBlob();
  
  const originalBitmap = await createImageBitmap(originalBlob);
  const maskBitmap = await createImageBitmap(maskBlob);

  // 2. Creem el Canvas de sortida final a la MIDA ORIGINAL
  const outCanvas = new OffscreenCanvas(width, height);
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('Failed to create 2D context for output canvas.');
  }

  // 3. Primer, dibuixem la màscara estirada a la resolució original
  outCtx.drawImage(maskBitmap, 0, 0, width, height);
  
  // 4. Apliquem el mode de fusió màgic: 'source-in' 
  // Això fa que el que dibuixem a continuació NOMÉS es conservi on la màscara no és transparent
  outCtx.globalCompositeOperation = 'source-in';
  
  // 5. Dibuixem la imatge original a sobre
  outCtx.drawImage(originalBitmap, 0, 0, width, height);

  // Llegim els píxels finals amb el fons eliminat a màxima resolució
  const outputImageData = outCtx.getImageData(0, 0, width, height);

  return outputImageData;
}

self.onmessage = async (event: MessageEvent<PostableMessage>) => {
  const message = event.data;

  if (message.type === 'reset') {
    initialized = false;
    return;
  }

  if (message.type === 'init') {
    try {
      await initBackgroundRemover();
    } catch (error: any) {
      console.error('[Worker] Error in init:', error);
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
      await initBackgroundRemover();

      const output = await removeBackgroundWithRMBG(imageData);

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
      console.error('[Worker] Error in process-image:', error);
      self.postMessage({
        type: 'error',
        id,
        message: error?.message || "L'IA ha fallat en processar aquesta imatge.",
      });
    }
  } 
};