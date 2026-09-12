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
} from './upscaler.types';

declare const self: Worker;

interface PostableMessage {
  type: string;
  [key: string]: any;
}

// Optional: Configure environment for production
env.allowLocalModels = false;

let initialized = false;
let upscalerPromise: Promise<any> | null = null;
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
      phase: `Model Swin2SR loaded and ready (${currentDevice})`
    });
  }
}

async function getUpscaler() {
  if (!upscalerPromise) {
    upscalerPromise = new Promise(async (resolve, reject) => {
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
        const pipe = await pipeline('image-to-image', 'Xenova/swin2SR-classical-sr-x2-64', {
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
  return upscalerPromise;
}

async function initUpscaler(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    self.postMessage({
      type: 'status',
      status: 'loading-model',
      message: "Initializing Swin2SR x2 model...",
    });

    await getUpscaler();

    initialized = true;
    self.postMessage({
      type: 'status',
      status: 'ready',
      message: `Model Swin2SR ready to process (${currentDevice}).`,
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

async function upscaleImage(imageData: ImageData): Promise<ImageData> {
  const upscaler = await getUpscaler();
  
  // Transformers.js v3 requires RawImage
  const imageToProcess = new RawImage(imageData.data, imageData.width, imageData.height, 4);
  
  // Execute the pipeline
  const outputs = await upscaler(imageToProcess);
  
  // Output could be an array or an object depending on the pipeline
  const finalImage = Array.isArray(outputs) ? outputs[0] : outputs;
  
  if (finalImage instanceof RawImage || finalImage.data) {
     // Create a new canvas to draw the RawImage so we can properly extract ImageData with RGBA
     // Often the output of these models is RGB (3 channels).
     const outCanvas = new OffscreenCanvas(finalImage.width, finalImage.height);
     const outCtx = outCanvas.getContext('2d');
     if (!outCtx) throw new Error('Failed to create 2D context.');
     
     // Convert RawImage to blob, then to bitmap, then draw to extract clean RGBA ImageData
     const blob = await finalImage.toBlob();
     const bitmap = await createImageBitmap(blob);
     outCtx.drawImage(bitmap, 0, 0);
     return outCtx.getImageData(0, 0, finalImage.width, finalImage.height);
  }

  throw new Error('Failed to process image output.');
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
      console.error('[Worker] Error in process-image:', error);
      self.postMessage({
        type: 'error',
        id,
        message: error?.message || "L'IA ha fallat en processar aquesta imatge.",
      });
    }
  } 
};