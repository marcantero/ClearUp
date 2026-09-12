import React, { useEffect, useRef, useState } from 'react';
import { sileo } from 'sileo';
import BackgroundRemoverWorker from '../workers/backgroundRemover.worker?worker';
import type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
  WorkerResultMessage,
  WorkerStatusMessage,
} from '../workers/backgroundRemover.types';

type UploadStatus = 'idle' | 'uploading' | 'loaded';
type ProcessingStatus = 'idle' | 'processing' | 'done' | 'error';


export type WorkerState = {
  modelStatus: 'idle' | 'loading' | 'ready' | 'error';
  uploadStatus: UploadStatus;
  processingStatus: ProcessingStatus;
};

export const IMAGE_PROCESS_ID = 'clearcut-active-image-job';
const TOAST_MODEL_ID = 'clear-cut-model-loader';

export function useBackgroundWorker(
  latestRequestIdRef: React.MutableRefObject<string | null>,
  onSuccess: (id: string, imageData: ImageData) => void
) {
  const [state, setState] = useState<WorkerState>({
    modelStatus: 'idle',
    uploadStatus: 'idle',
    processingStatus: 'idle',
  });

  const workerRef = useRef<Worker | null>(null);
  const lastProgressUpdateRef = useRef(0); // <-- CLAU: Evita saturar Sileo

  useEffect(() => {
    const worker = new BackgroundRemoverWorker();
    workerRef.current = worker;

    // Estat inicial
    sileo.info({
      id: TOAST_MODEL_ID,
      title: 'Initializing AI',
      description: 'Preparing environment...',
      duration: Infinity,
    });

    const handleMessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;

      if (message.type === 'model-progress') {
        const now = Date.now();
        // Limitem actualitzacions a un cop cada 150ms
        if (now - lastProgressUpdateRef.current < 150) return;
        lastProgressUpdateRef.current = now;

        setState((prev) => ({ ...prev, modelStatus: 'loading' }));
        
        const percentage = Math.max(0, Math.min(100, Math.round(message.progress)));
        
        sileo.info({
          id: TOAST_MODEL_ID,
          title: 'Loading AI model',
          description: (
            <div className="mt-1 w-full min-w-[240px] space-y-2 py-1">
              <div className="flex justify-between text-[11px] font-medium text-slate-500">
                <span>{message.phase || 'Downloading weights'}...</span>
                <span className="font-mono text-red-500">{percentage}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-red-500 transition-all duration-150" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          ),
          duration: Infinity,
        });
        return;
      }

      if (message.type === 'status') {
        if (message.status === 'ready') {
          setState((prev) => ({ ...prev, modelStatus: 'ready' }));
          // Esperem 800ms abans de l'èxit per no ser bruscos
          setTimeout(() => {
            sileo.success({
              id: TOAST_MODEL_ID,
              title: 'AI model ready',
              description: 'Everything runs locally.',
              duration: 3000,
            });
          }, 800);
        } else if (message.status === 'error') {
          sileo.error({ id: TOAST_MODEL_ID, title: 'Error', description: message.message });
        }
        return;
      }

      if (message.type === 'processing') {
        setState((prev) => ({
          ...prev,
          processingStatus: message.status === 'started' ? 'processing' : 'done',
        }));
        return;
      }

      if (message.type === 'result') {
        const { id, imageData } = message as WorkerResultMessage;
        if (latestRequestIdRef.current && id !== latestRequestIdRef.current) return;

        sileo.success({
          id: IMAGE_PROCESS_ID,
          title: 'Background removed',
          duration: 2200,
        });

        setState((prev) => ({ ...prev, processingStatus: 'done' }));
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
        setState((prev) => ({ ...prev, processingStatus: 'error' }));
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

  // Timeout de seguretat de 25s si la connexió s'ha quedat penjada
  useEffect(() => {
    if (state.modelStatus !== 'loading') return;
    const timeoutId = window.setTimeout(() => {
      setState((prev) => {
        if (prev.modelStatus !== 'loading') return prev;
        sileo.error({
          id: TOAST_MODEL_ID,
          title: 'Loading timeout',
          description: 'Taking too long. Please refresh.',
        });
        return { ...prev, modelStatus: 'error' };
      });
    }, 25000);
    return () => window.clearTimeout(timeoutId);
  }, [state.modelStatus]);

  const processImage = (id: string, imageData: ImageData) => {
    workerRef.current?.postMessage({ type: 'process-image', id, imageData } as WorkerIncomingMessage);
  };

  return { state, setState, processImage };
}