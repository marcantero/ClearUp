// Types shared with main thread (sense dependències externes)
export type WorkerInitMessage = { type: 'init' };
export type WorkerResetMessage = { type: 'reset' };
export type WorkerProcessMessage = {
  type: 'process-image';
  id: string;
  imageData: ImageData;
  /**
   * Optional threshold controlling how aggressively background pixels are removed.
   * Higher values treat more colours as background.
   */
  threshold?: number;
};

export type WorkerIncomingMessage = WorkerInitMessage | WorkerResetMessage | WorkerProcessMessage;

export type WorkerStatusMessage = {
  type: 'status';
  status: 'loading-model' | 'ready' | 'error';
  message?: string;
};

export type WorkerModelProgressMessage = {
  type: 'model-progress';
  progress: number;
  phase?: string;
};

export type WorkerResultMessage = {
  type: 'result';
  id: string;
  imageData: ImageData;
};

export type WorkerProcessingMessage = {
  type: 'processing';
  id: string;
  status: 'started' | 'finished';
};

export type WorkerErrorMessage = {
  type: 'error';
  id?: string;
  message: string;
};

export type WorkerOutgoingMessage =
  | WorkerStatusMessage
  | WorkerModelProgressMessage
  | WorkerResultMessage
  | WorkerProcessingMessage
  | WorkerErrorMessage;
