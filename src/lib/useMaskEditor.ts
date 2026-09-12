import { useCallback, useEffect, useRef, useState } from 'react';

export type BrushMode = 'restore' | 'erase';

interface UseMaskEditorOptions {
  width: number;
  height: number;
  brushSize: number;
  brushMode: BrushMode;
  /** Cridat a cada segment de traç (temps real) i al final del traç */
  onStroke?: () => void;
}

/**
 * Two internal hidden canvases:
 *   restoreCanvas → white pixels where user wants to restore from original
 *   eraseCanvas   → black pixels where user wants to erase from AI result
 *
 * getCorrectionMask() merges both into a single ImageData that refineMask() understands:
 *   white (255,255,255,255) → RESTORE
 *   black (0,0,0,255)       → ERASE
 *   transparent (a=0)       → no correction
 */
export function useMaskEditor({
  width,
  height,
  brushSize,
  brushMode,
  onStroke,
}: UseMaskEditorOptions) {
  // Visible canvas (semitransparent overlay that user sees)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Hidden canvases to accumulate masks
  const restoreCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraseCanvasRef   = useRef<HTMLCanvasElement | null>(null);

  const isDrawingRef = useRef(false);
  const lastPosRef   = useRef<{ x: number; y: number } | null>(null);
  const [hasEdits, setHasEdits] = useState(false);

  // Initialize / resize all canvases when dimensions change
  useEffect(() => {
    if (width === 0 || height === 0) return;

    for (const ref of [overlayCanvasRef, restoreCanvasRef, eraseCanvasRef]) {
      const c = ref.current;
      if (!c) continue;
      c.width  = width;
      c.height = height;
    }
    setHasEdits(false);
  }, [width, height]);

  // Create hidden canvases once and resize
  useEffect(() => {
    restoreCanvasRef.current = document.createElement('canvas');
    eraseCanvasRef.current   = document.createElement('canvas');
    
    if (width > 0 && height > 0) {
      if (restoreCanvasRef.current) {
        restoreCanvasRef.current.width = width;
        restoreCanvasRef.current.height = height;
      }
      if (eraseCanvasRef.current) {
        eraseCanvasRef.current.width = width;
        eraseCanvasRef.current.height = height;
      }
    }
  }, [width, height]);

  const getScaledPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return null;
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top)  * scaleY,
      };
    },
    []
  );

  const paintSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      
      // ── Hidden canvas (real mask) ──────────────────────────────────────
      const maskCanvas = brushMode === 'restore'
        ? restoreCanvasRef.current
        : eraseCanvasRef.current;
        
      // AFEGIT: Agafem també la màscara contrària
      const oppositeCanvas = brushMode === 'restore'
        ? eraseCanvasRef.current
        : restoreCanvasRef.current; 

      if (!maskCanvas || !oppositeCanvas) return;

      // 1. Pintem a la màscara seleccionada
      const mCtx = maskCanvas.getContext('2d');
      if (mCtx) {
        mCtx.save();
        mCtx.globalCompositeOperation = 'source-over';
        mCtx.lineCap   = 'round';
        mCtx.lineJoin  = 'round';
        mCtx.lineWidth = brushSize;
        mCtx.strokeStyle = brushMode === 'restore' ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
        mCtx.beginPath();
        mCtx.moveTo(from.x, from.y);
        mCtx.lineTo(to.x,   to.y);
        mCtx.stroke();
        mCtx.restore();
      }

      // 2. AFEGIT: Actuem com una goma d'esborrar a la màscara contrària
      const oppCtx = oppositeCanvas.getContext('2d');
      if (oppCtx) {
        oppCtx.save();
        oppCtx.globalCompositeOperation = 'destination-out'; // Això fa d'esborrador
        oppCtx.lineCap   = 'round';
        oppCtx.lineJoin  = 'round';
        oppCtx.lineWidth = brushSize;
        oppCtx.beginPath();
        oppCtx.moveTo(from.x, from.y);
        oppCtx.lineTo(to.x,   to.y);
        oppCtx.stroke();
        oppCtx.restore();
      }
    },
    [brushSize, brushMode]
  );

  const onPointerDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDrawingRef.current = true;
      const pos = getScaledPos(e);
      if (!pos) return;
      lastPosRef.current = pos;
      paintSegment(pos, pos);
      setHasEdits(true);
      onStroke?.();
    },
    [getScaledPos, paintSegment, onStroke, brushMode]
  );

  const onPointerMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const pos = getScaledPos(e);
      if (!pos || !lastPosRef.current) return;
      paintSegment(lastPosRef.current, pos);
      lastPosRef.current = pos;
      setHasEdits(true);
      onStroke?.();
    },
    [getScaledPos, paintSegment, onStroke]
  );

  const onPointerUp = useCallback(() => {
    isDrawingRef.current   = false;
    lastPosRef.current     = null;
  }, []);

  const onPointerLeave = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current   = null;
  }, []);

  /**
   * Merges restoreCanvas (white) + eraseCanvas (black) into a single ImageData.
   * Priority: erase > restore > none.
   */
  const getCorrectionMask = useCallback((): ImageData | null => {
    const rCanvas = restoreCanvasRef.current;
    const eCanvas = eraseCanvasRef.current;
    if (!rCanvas || !eCanvas || rCanvas.width === 0) return null;

    const { width: w, height: h } = rCanvas;
    const out  = new ImageData(w, h);

    const rCtx = rCanvas.getContext('2d');
    const eCtx = eCanvas.getContext('2d');
    if (!rCtx || !eCtx) return null;

    const rData = rCtx.getImageData(0, 0, w, h).data;
    const eData = eCtx.getImageData(0, 0, w, h).data;
    const o     = out.data;

    for (let i = 0; i < o.length; i += 4) {
      const hasErase   = eData[i + 3] > 0;
      const hasRestore = rData[i + 3] > 0;

      if (hasErase) {
        o[i] = 0; o[i+1] = 0; o[i+2] = 0; o[i+3] = 255;
      } else if (hasRestore) {
        o[i] = 255; o[i+1] = 255; o[i+2] = 255; o[i+3] = 255;
      }
    }

    return out;
  }, []);

  const clearEdits = useCallback(() => {
    for (const ref of [overlayCanvasRef, restoreCanvasRef, eraseCanvasRef]) {
      const c = ref.current;
      if (!c) continue;
      const ctx = c.getContext('2d');
      ctx?.clearRect(0, 0, c.width, c.height);
    }
    setHasEdits(false);
  }, []);

  /**
   * Exposed so external tools (e.g. flood fill) can paint directly onto the
   * hidden mask canvases and the visible overlay, keeping full architectural
   * parity with brush strokes.
   */
  const getHiddenCanvases = useCallback(() => ({
    restoreCanvas: restoreCanvasRef.current,
    eraseCanvas:   eraseCanvasRef.current,
    overlayCanvas: overlayCanvasRef.current,
  }), []);

  /**
   * Called by external tools after they have painted onto the hidden canvases
   * directly, so hasEdits is updated and onStroke fires — identical lifecycle
   * to a brush stroke.
   */
  const notifyExternalEdit = useCallback(() => {
    setHasEdits(true);
    onStroke?.();
  }, [onStroke]);

  return {
    canvasRef: overlayCanvasRef,
    hasEdits,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    getCorrectionMask,
    clearEdits,
    getHiddenCanvases,
    notifyExternalEdit,
  };
}