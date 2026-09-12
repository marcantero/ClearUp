import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { useMaskEditor, BrushMode } from '../lib/useMaskEditor';
import { useSmartBrush } from '../lib/useSmartBrush';
import { refineMask } from '../lib/refineMask';

interface MaskEditorOverlayProps {
  originalImageData: ImageData;
  aiResultImageData: ImageData;
  onRefined: (refined: ImageData) => void;
}

type ActiveTool = 'brush' | 'smart';

const BRUSH_SIZES = [8, 16, 32, 56, 80];
const TOLERANCE_PRESETS = [
  { label: 'Exact', value: 8   },
  { label: 'Low',   value: 25  },
  { label: 'Med',   value: 55  },
  { label: 'High',  value: 90  },
  { label: 'Max',   value: 140 },
] as const;

type HistoryStep = { restore: ImageData; erase: ImageData; overlay: ImageData };

export function MaskEditorOverlay({
  originalImageData,
  aiResultImageData,
  onRefined,
}: MaskEditorOverlayProps) {
  const [brushSize,  setBrushSize]  = useState(32);
  const [brushMode,  setBrushMode]  = useState<BrushMode>('restore');
  const [activeTool, setActiveTool] = useState<ActiveTool>('brush');
  const [tolerance,  setTolerance]  = useState(55);

  const historyRef       = useRef<HistoryStep[]>([]);
  const historyIndexRef  = useRef<number>(-1);
  const isPointerDownRef = useRef(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const displayCanvasRef     = useRef<HTMLCanvasElement | null>(null);
  const getCorrectionMaskRef = useRef<(() => ImageData | null) | null>(null);
  const onRefinedRef         = useRef(onRefined);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempResultCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = originalImageData.width;
    c.height = originalImageData.height;
    c.getContext('2d')?.putImageData(originalImageData, 0, 0);
    originalCanvasRef.current = c;
  }, [originalImageData]);

  useLayoutEffect(() => { onRefinedRef.current = onRefined; }, [onRefined]);

  const strokeVisitedRef = useRef<Uint8Array | null>(null);
  const pendingFrameRef  = useRef<number | null>(null);

  const syncHistoryUI = useCallback(() => {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, []);

  const drawResultOnDisplay = useCallback((result: ImageData) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width  = result.width;
    canvas.height = result.height;

    const isDark = document.documentElement.classList.contains('dark');
    const tileColorA = isDark ? '#1a2235' : '#ffffff';
    const tileColorB = isDark ? '#111827' : '#f1f5f9';

    const TILE = 14;
    for (let y = 0; y < canvas.height; y += TILE) {
      for (let x = 0; x < canvas.width; x += TILE) {
        ctx.fillStyle = (x / TILE + y / TILE) % 2 === 0 ? tileColorA : tileColorB;
        ctx.fillRect(x, y, TILE, TILE);
      }
    }

    if (originalCanvasRef.current) {
      ctx.save();
      ctx.globalAlpha = isDark ? 0.25 : 0.15;
      ctx.filter = 'grayscale(100%)';
      ctx.drawImage(originalCanvasRef.current, 0, 0);
      ctx.restore();
    }

    if (!tempResultCanvasRef.current) {
      tempResultCanvasRef.current = document.createElement('canvas');
    }
    const tempCanvas = tempResultCanvasRef.current;
    tempCanvas.width = result.width;
    tempCanvas.height = result.height;
    tempCanvas.getContext('2d')?.putImageData(result, 0, 0);

    ctx.drawImage(tempCanvas, 0, 0);
  }, []);

  useEffect(() => {
    if (overlayCanvasRef.current) {
      overlayCanvasRef.current.width  = aiResultImageData.width;
      overlayCanvasRef.current.height = aiResultImageData.height;
    }
    drawResultOnDisplay(aiResultImageData);
  }, [aiResultImageData, drawResultOnDisplay]);

  const applyRefinement = useCallback(() => {
    const mask = getCorrectionMaskRef.current?.();
    if (!mask) return;
    const refined = refineMask(aiResultImageData, originalImageData, mask);
    drawResultOnDisplay(refined);
    onRefinedRef.current(refined);
  }, [aiResultImageData, originalImageData, drawResultOnDisplay]);

  useEffect(() => {
    const observer = new MutationObserver(() => { applyRefinement(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [applyRefinement]);

  const handleBrushStroke = useCallback(() => { applyRefinement(); }, [applyRefinement]);

  const scheduleRefinement = useCallback(() => {
    if (pendingFrameRef.current !== null) return;
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      applyRefinement();
    });
  }, [applyRefinement]);

  const {
    canvasRef: overlayCanvasRef,
    hasEdits,
    onPointerDown:  brushPointerDown,
    onPointerMove:  brushPointerMove,
    onPointerUp:    brushPointerUp,
    onPointerLeave: brushPointerLeave,
    getCorrectionMask,
    clearEdits,
    getHiddenCanvases,
    notifyExternalEdit,
  } = useMaskEditor({
    width:    aiResultImageData.width,
    height:   aiResultImageData.height,
    brushSize,
    brushMode,
    onStroke: activeTool === 'brush' ? handleBrushStroke : undefined,
  });

  useLayoutEffect(() => { getCorrectionMaskRef.current = getCorrectionMask; }, [getCorrectionMask]);

  const captureSnapshot = useCallback(() => {
    const { restoreCanvas, eraseCanvas } = getHiddenCanvases();
    const overlayCanvas = overlayCanvasRef.current;
    if (!restoreCanvas || !eraseCanvas || !overlayCanvas || restoreCanvas.width === 0) return;

    const rCtx = restoreCanvas.getContext('2d');
    const eCtx = eraseCanvas.getContext('2d');
    const oCtx = overlayCanvas.getContext('2d');
    if (!rCtx || !eCtx || !oCtx) return;

    const step: HistoryStep = {
      restore: rCtx.getImageData(0, 0, restoreCanvas.width, restoreCanvas.height),
      erase:   eCtx.getImageData(0, 0, eraseCanvas.width, eraseCanvas.height),
      overlay: oCtx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height),
    };

    const currIdx = historyIndexRef.current;
    const nextHistory = historyRef.current.slice(0, currIdx + 1);
    nextHistory.push(step);
    if (nextHistory.length > 20) nextHistory.shift();

    historyRef.current      = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    syncHistoryUI();
  }, [getHiddenCanvases, syncHistoryUI]);

  useEffect(() => {
    const { restoreCanvas, eraseCanvas } = getHiddenCanvases();
    const overlayCanvas = overlayCanvasRef.current;
    if (!restoreCanvas || !eraseCanvas || !overlayCanvas || restoreCanvas.width === 0) return;
    const rCtx = restoreCanvas.getContext('2d');
    const eCtx = eraseCanvas.getContext('2d');
    const oCtx = overlayCanvas.getContext('2d');
    if (!rCtx || !eCtx || !oCtx) return;

    const step0: HistoryStep = {
      restore: rCtx.getImageData(0, 0, restoreCanvas.width, restoreCanvas.height),
      erase:   eCtx.getImageData(0, 0, eraseCanvas.width, eraseCanvas.height),
      overlay: oCtx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height),
    };

    historyRef.current      = [step0];
    historyIndexRef.current = 0;
    syncHistoryUI();
  }, [aiResultImageData, getHiddenCanvases, syncHistoryUI]);

  const applyHistoryStep = useCallback((targetIndex: number) => {
    const step = historyRef.current[targetIndex];
    if (!step) return;
    const { restoreCanvas, eraseCanvas } = getHiddenCanvases();
    const overlayCanvas = overlayCanvasRef.current;

    restoreCanvas?.getContext('2d')?.putImageData(step.restore, 0, 0);
    eraseCanvas?.getContext('2d')?.putImageData(step.erase, 0, 0);
    overlayCanvas?.getContext('2d')?.putImageData(step.overlay, 0, 0);

    historyIndexRef.current = targetIndex;
    syncHistoryUI();
    notifyExternalEdit();

    const mask = getCorrectionMaskRef.current?.();
    if (mask) {
      const refined = refineMask(aiResultImageData, originalImageData, mask);
      drawResultOnDisplay(refined);
      onRefinedRef.current(refined);
    } else {
      drawResultOnDisplay(aiResultImageData);
      onRefinedRef.current(aiResultImageData);
    }
  }, [getHiddenCanvases, syncHistoryUI, notifyExternalEdit, aiResultImageData, originalImageData, drawResultOnDisplay]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    applyHistoryStep(historyIndexRef.current - 1);
  }, [applyHistoryStep]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    applyHistoryStep(historyIndexRef.current + 1);
  }, [applyHistoryStep]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleBrushDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isPointerDownRef.current = true;
    brushPointerDown(e);
  }, [brushPointerDown]);

  const handleBrushUp = useCallback(() => {
    if (isPointerDownRef.current) {
      isPointerDownRef.current = false;
      brushPointerUp();
      captureSnapshot();
    } else brushPointerUp();
  }, [brushPointerUp, captureSnapshot]);

  const handleBrushLeave = useCallback(() => {
    if (isPointerDownRef.current) {
      isPointerDownRef.current = false;
      brushPointerLeave();
      captureSnapshot();
    } else brushPointerLeave();
  }, [brushPointerLeave, captureSnapshot]);

  const { fillAt, createStrokeState, getScaledPos } = useSmartBrush();

  const handleSmartDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isPointerDownRef.current = true;
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    strokeVisitedRef.current = createStrokeState(aiResultImageData.width, aiResultImageData.height);
    const pos = getScaledPos(e, canvas);
    const { restoreCanvas, eraseCanvas } = getHiddenCanvases();
    
    const maskCanvas = brushMode === 'restore' ? restoreCanvas : eraseCanvas;
    const oppositeCanvas = brushMode === 'restore' ? eraseCanvas : restoreCanvas;
    if (!maskCanvas || !oppositeCanvas) return;

    fillAt(originalImageData, maskCanvas, canvas, pos.x, pos.y, brushSize, tolerance, brushMode, strokeVisitedRef.current);
    
    const oppCtx = oppositeCanvas.getContext('2d');
    if (oppCtx) {
      oppCtx.save();
      oppCtx.globalCompositeOperation = 'destination-out';
      oppCtx.drawImage(maskCanvas, 0, 0);
      oppCtx.restore();
    }
    notifyExternalEdit();
    scheduleRefinement();
  }, [overlayCanvasRef, createStrokeState, aiResultImageData, getScaledPos, getHiddenCanvases, brushMode, fillAt, originalImageData, brushSize, tolerance, notifyExternalEdit, scheduleRefinement]);
  
  const smartPointerMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!strokeVisitedRef.current) return;
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const pos = getScaledPos(e, canvas);
    const { restoreCanvas, eraseCanvas } = getHiddenCanvases();
    
    const maskCanvas = brushMode === 'restore' ? restoreCanvas : eraseCanvas;
    const oppositeCanvas = brushMode === 'restore' ? eraseCanvas : restoreCanvas;
    if (!maskCanvas || !oppositeCanvas) return;

    fillAt(originalImageData, maskCanvas, canvas, pos.x, pos.y, brushSize, tolerance, brushMode, strokeVisitedRef.current);
    
    const oppCtx = oppositeCanvas.getContext('2d');
    if (oppCtx) {
      oppCtx.save();
      oppCtx.globalCompositeOperation = 'destination-out';
      oppCtx.drawImage(maskCanvas, 0, 0);
      oppCtx.restore();
    }
    notifyExternalEdit();
    scheduleRefinement();
  }, [overlayCanvasRef, getScaledPos, getHiddenCanvases, brushMode, fillAt, originalImageData, brushSize, tolerance, notifyExternalEdit, scheduleRefinement]);

  const handleSmartUp = useCallback(() => {
    strokeVisitedRef.current = null;
    if (pendingFrameRef.current !== null) { cancelAnimationFrame(pendingFrameRef.current); pendingFrameRef.current = null; }
    applyRefinement();
    if (isPointerDownRef.current) {
      isPointerDownRef.current = false;
      captureSnapshot();
    }
  }, [applyRefinement, captureSnapshot]);

  const handleSmartLeave = useCallback(() => {
    strokeVisitedRef.current = null;
    if (isPointerDownRef.current) {
      isPointerDownRef.current = false;
      captureSnapshot();
    }
  }, [captureSnapshot]);

  const canvasProps = activeTool === 'brush'
    ? { onMouseDown: handleBrushDown, onMouseMove: brushPointerMove, onMouseUp: handleBrushUp, onMouseLeave: handleBrushLeave }
    : { onMouseDown: handleSmartDown, onMouseMove: smartPointerMove, onMouseUp: handleSmartUp, onMouseLeave: handleSmartLeave };

  const handleClear = () => {
    clearEdits();
    drawResultOnDisplay(aiResultImageData);
    onRefinedRef.current(aiResultImageData);
    captureSnapshot();
  };

  const getCursor = (): string => {
    const sz   = Math.max(16, Math.min(96, brushSize * 2));
    const half = sz / 2;
    const isDark = document.documentElement.classList.contains('dark');

    if (activeTool === 'brush') {
      const col = brushMode === 'restore' ? (isDark ? 'white' : '%230f172a') : '%23f87171';
      const fop = brushMode === 'restore' ? '0.12' : '0.08';
      const svg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}'%3E%3Ccircle cx='${half}' cy='${half}' r='${half - 1}' stroke='${col}' stroke-width='1.5' fill='${col}' fill-opacity='${fop}'/%3E%3C/svg%3E`;
      return `url("${svg}") ${half} ${half}, crosshair`;
    }
    const col = brushMode === 'restore' ? '%2310b981' : '%23f87171';
    const svg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}'%3E%3Ccircle cx='${half}' cy='${half}' r='${half - 1}' stroke='${col}' stroke-width='2' stroke-dasharray='4 3' fill='${col}' fill-opacity='0.07'/%3E%3Cline x1='${half}' y1='${half-4}' x2='${half}' y2='${half+4}' stroke='${col}' stroke-width='1.5'/%3E%3Cline x1='${half-4}' y1='${half}' x2='${half+4}' y2='${half}' stroke='${col}' stroke-width='1.5'/%3E%3C/svg%3E`;
    return `url("${svg}") ${half} ${half}, crosshair`;
  };

  return (
    <div className="flex h-full max-h-full w-full flex-col gap-3 overflow-hidden">
      
      {/* ── TOOLBAR PRINCIPAL ────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none transition-all">
        
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-slate-100 p-0.5 dark:border-white/[0.06] dark:bg-black/20">
          <ToolBtn active={brushMode === 'restore'} activeClass="bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:border-transparent dark:bg-emerald-500/20 dark:text-emerald-300 shadow-sm dark:shadow-none" onClick={() => setBrushMode('restore')}>
            <span className="text-[10px]">✦</span> Restore
          </ToolBtn>
          <ToolBtn active={brushMode === 'erase'} activeClass="bg-rose-50 text-rose-700 border border-rose-200/80 dark:border-transparent dark:bg-rose-500/20 dark:text-rose-300 shadow-sm dark:shadow-none" onClick={() => setBrushMode('erase')}>
            <span className="text-[10px]">◌</span> Erase
          </ToolBtn>
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-white/[0.08]" />

        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-slate-100 p-0.5 dark:border-white/[0.06] dark:bg-black/20">
          <button type="button" onClick={undo} disabled={!historyState.canUndo} title="Desfer (Ctrl+Z)" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-slate-100 dark:hover:shadow-none disabled:opacity-25 transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>
          <button type="button" onClick={redo} disabled={!historyState.canRedo} title="Refer (Ctrl+Shift+Z)" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-slate-100 dark:hover:shadow-none disabled:opacity-25 transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-white/[0.08]" />

        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/80 bg-slate-100 p-0.5 dark:border-white/[0.06] dark:bg-black/20">
          <ToolBtn active={activeTool === 'brush'} activeClass="bg-white text-cyan-700 border border-slate-200/80 shadow-sm dark:border-transparent dark:bg-cyan-500/20 dark:text-cyan-300 dark:shadow-none" onClick={() => setActiveTool('brush')} title="Freehand brush">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            Brush
          </ToolBtn>
          <ToolBtn active={activeTool === 'smart'} activeClass="bg-white text-cyan-700 border border-slate-200/80 shadow-sm dark:border-transparent dark:bg-cyan-500/20 dark:text-cyan-300 dark:shadow-none" onClick={() => setActiveTool('smart')} title="Smart brush">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
            Smart
          </ToolBtn>
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-white/[0.08]" />

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400 dark:text-slate-600">Size</span>
          <div className="flex items-center gap-1">
            {BRUSH_SIZES.map((size) => (
              <button key={size} type="button" onClick={() => setBrushSize(size)} title={`${size}px`} className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${brushSize === size ? 'bg-cyan-50 dark:bg-cyan-400/15 ring-1 ring-cyan-500/40 dark:ring-cyan-400/50' : 'hover:bg-slate-100 dark:hover:bg-white/[0.05]'}`}>
                <span className={`rounded-full transition-colors ${brushSize === size ? 'bg-cyan-600 dark:bg-cyan-400' : 'bg-slate-400 dark:bg-slate-600'}`} style={{ width: Math.max(3, Math.min(14, size / 5)), height: Math.max(3, Math.min(14, size / 5)) }} />
              </button>
            ))}
          </div>
        </div>

        {activeTool === 'smart' && (
          <>
            <div className="h-5 w-px bg-slate-200 dark:bg-white/[0.08]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400 dark:text-slate-600">Tolerance</span>
              <div className="flex items-center gap-0.5">
                {TOLERANCE_PRESETS.map(({ label, value }) => (
                  <button key={value} type="button" onClick={() => setTolerance(value)} title={`RGB distance ≤ ${value}`} className={`rounded-md px-2 py-1 text-[10px] font-medium transition-all ${tolerance === value ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-500/30 dark:bg-cyan-400/15 dark:text-cyan-300 dark:ring-cyan-400/40' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {hasEdits && (
          <button type="button" onClick={handleClear} className="ml-auto rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:ring-white/[0.06] dark:hover:bg-transparent dark:hover:text-rose-400 transition">
            Clear
          </button>
        )}
      </div>

      {/* ── CANVAS AREA ─────────────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.06] flex items-center justify-center bg-white dark:bg-black/20 shadow-sm dark:shadow-none transition-all" style={{ touchAction: 'none' }}>
        <div className="relative flex items-center justify-center h-full w-full p-2">
          <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${aiResultImageData.width} / ${aiResultImageData.height}` }}>
            <canvas ref={displayCanvasRef} className="block h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 h-full w-full object-contain" style={{ cursor: getCursor(), touchAction: 'none' }} {...canvasProps} />
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-md shadow-sm dark:shadow-none ${brushMode === 'restore' ? 'border-emerald-500/30 bg-emerald-50/90 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-rose-500/30 bg-rose-50/90 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${brushMode === 'restore' ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-rose-500 dark:bg-rose-400'}`} />
            {brushMode === 'restore' ? 'Restoring' : 'Erasing'}
            {activeTool === 'smart' && <span className="ml-1 opacity-60">· Smart</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, activeClass, onClick, title }: { children: React.ReactNode; active: boolean; activeClass: string; onClick: () => void; title?: string; }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${active ? activeClass : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}>
      {children}
    </button>
  );
}