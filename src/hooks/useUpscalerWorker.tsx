import React, { useEffect, useRef, useState } from 'react';
import { sileo } from 'sileo';
import UpscalerWorker from '../workers/upscaler.worker?worker';
import type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
  WorkerResultMessage,
  WorkerStatusMessage,
} from '../workers/upscaler.types';

type UploadStatus = 'idle' | 'uploading' | 'loaded';
type ProcessingStatus = 'idle' | 'processing' | 'done' | 'error';


export type WorkerState = {
  modelStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelProgress?: number;
  modelPhase?: string;
  uploadStatus: UploadStatus;
  processingStatus: ProcessingStatus;
  processProgress?: number;
  processPhase?: string;
};

export const IMAGE_PROCESS_ID = 'clearup-active-image-job';
const TOAST_MODEL_ID = 'clear-up-model-loader';

export function useUpscalerWorker(
  latestRequestIdRef: React.MutableRefObject<string | null>,
  onSuccess: (id: string, imageData: ImageData) => void
) {
  const [state, setState] = useState<WorkerState>({
    modelStatus: 'idle',
    uploadStatus: 'idle',
    processingStatus: 'idle',
  });

  const workerRef = useRef<Worker | null>(null);
  const lastProgressUpdateRef = useRef(0);

  useEffect(() => {
    const worker = new UpscalerWorker();
    workerRef.current = worker;

    const handleMessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;

      if (message.type === 'model-progress') {
        const now = Date.now();
        if (now - lastProgressUpdateRef.current < 150) return;
        lastProgressUpdateRef.current = now;

        const percentage = Math.max(0, Math.min(100, Math.round(message.progress)));
        
        setState((prev) => ({ 
          ...prev, 
          modelStatus: 'loading',
          modelProgress: percentage,
          modelPhase: message.phase || 'Downloading weights'
        }));
        return;
      }

      if (message.type === 'process-progress') {
        const percentage = Math.max(0, Math.min(100, Math.round(message.progress)));
        setState((prev) => ({
          ...prev,
          modelStatus: 'ready',
          processingStatus: 'processing',
          processProgress: percentage,
          processPhase: message.phase || `Processant... ${percentage}%`,
        }));
        return;
      }

      if (message.type === 'status') {
        if (message.status === 'ready') {
          setState((prev) => ({ ...prev, modelStatus: 'ready', modelProgress: 100 }));
          setTimeout(() => {
            sileo.success({
              id: TOAST_MODEL_ID,
              title: 'AI model ready',
              description: 'Everything runs locally.',
              duration: 3000,
            });
          }, 800);
        } else if (message.status === 'error') {
          setState((prev) => ({ ...prev, modelStatus: 'error' }));
          sileo.error({ id: TOAST_MODEL_ID, title: 'Error', description: message.message });
        }
        return;
      }

      if (message.type === 'processing') {
        if (message.status === 'started') {
          setState((prev) => ({
            ...prev,
            modelStatus: 'ready',
            processingStatus: 'processing',
            processProgress: 0,
            processPhase: 'Iniciant upscaling...',
          }));
        } else if (message.status === 'finished') {
          setState((prev) => ({
            ...prev,
            modelStatus: 'ready',
            processingStatus: 'done',
          }));
        }
        return;
      }

      if (message.type === 'result') {
        const { id, imageData } = message as WorkerResultMessage;
        if (latestRequestIdRef.current && id !== latestRequestIdRef.current) return;

        sileo.success({
          id: IMAGE_PROCESS_ID,
          title: 'Image upscaled',
          duration: 2200,
        });

        setState((prev) => ({
          ...prev,
          modelStatus: 'ready',
          processingStatus: 'done',
          processProgress: 100,
        }));
        onSuccess(id, imageData);
        return;
      }

      if (message.type === 'error') {
        sileo.error({
          id: IMAGE_PROCESS_ID,
          title: 'Processing error',
          description: message.message,
          duration: 4000,
        });
        setState((prev) => ({
          ...prev,
          modelStatus: 'ready',
          processingStatus: 'error',
        }));
      }
    };

    const handleError = (event: ErrorEvent) => {
      event.preventDefault();
      sileo.error({
        id: TOAST_MODEL_ID,
        title: 'Worker error',
        description: 'Please reload the page.',
      });
      setState((prev) => ({ ...prev, modelStatus: 'error', processingStatus: 'error' }));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage({ type: 'reset' } as WorkerIncomingMessage);
    worker.postMessage({ type: 'init' } as WorkerIncomingMessage);

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.terminate();
    };
  }, [onSuccess, latestRequestIdRef]);

  const processImage = (id: string, imageData: ImageData) => {
    setState((prev) => ({
      ...prev,
      modelStatus: 'ready',
      processingStatus: 'processing',
      processProgress: 0,
      processPhase: 'Preparant imatge...',
    }));
    workerRef.current?.postMessage({ type: 'process-image', id, imageData } as WorkerIncomingMessage);
  };

  return { state, setState, processImage };
}