import { useEffect, useRef, useState, KeyboardEvent } from 'react';

export type ImageCompareSliderProps = {
  originalSrc: string;
  processedSrc: string;
  animationKey?: string;
};

export function ImageCompareSlider({
  originalSrc,
  processedSrc,
  animationKey,
}: ImageCompareSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  
  const [dimensions, setDimensions] = useState<{
    original: { width: number; height: number } | null;
    processed: { width: number; height: number } | null;
  }>({ original: null, processed: null });

  // Refs pels elements del DOM
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  
  const positionRef = useRef(50);
  const frameIdRef = useRef<number | null>(null);
  
  const [ariaPosition, setAriaPosition] = useState(50);

  const updatePosition = (value: number) => {
    const clamped = Math.min(100, Math.max(0, value));
    positionRef.current = clamped;
    
    if (clipRef.current) {
      clipRef.current.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    }
    if (handleRef.current) {
      handleRef.current.style.left = `${clamped}%`;
    }
  };

  // Animació inicial
  useEffect(() => {
    if (!animationKey) return;

    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }

    updatePosition(5);
    const start = performance.now();
    const duration = 1200; 

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = 5 + eased * 45; 
      
      updatePosition(value);

      if (t < 1) {
        frameIdRef.current = requestAnimationFrame(step);
      } else {
        setAriaPosition(value); 
      }
    };

    frameIdRef.current = requestAnimationFrame(step);

    return () => {
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
    };
  }, [animationKey]);

  // Arrossegament amb ratolí/tàctil
  useEffect(() => {
    if (!isDragging || !containerRef.current) return;

    const container = containerRef.current;
    let rect = container.getBoundingClientRect();

    const handleMove = (e: PointerEvent) => {
      e.preventDefault(); 
      const x = e.clientX - rect.left;
      const percentage = (x / rect.width) * 100;
      updatePosition(percentage);
    };

    const handleUp = () => {
      setIsDragging(false);
      setAriaPosition(positionRef.current);
    };
    
    const handleResize = () => {
      rect = container.getBoundingClientRect();
    };

    document.addEventListener('pointermove', handleMove, { passive: false });
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('resize', handleResize);
    };
  }, [isDragging]);

  const handlePointerMoveOverContainer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      setZoomPos({ x, y });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      updatePosition(positionRef.current - 5);
      setAriaPosition(positionRef.current);
    }
    if (e.key === 'ArrowRight') {
      updatePosition(positionRef.current + 5);
      setAriaPosition(positionRef.current);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-3 transition-transform duration-500 ease-out">
      {/* Barra de controls superior */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18-6-6 6-6"/>
            <path d="m15 6 6 6-6 6"/>
          </svg>
          <span>Arrossega la barra per comparar</span>
        </div>

        <button
          type="button"
          onClick={() => setIsZoomed(!isZoomed)}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all shadow-sm ${
            isZoomed
              ? 'bg-red-500 text-white shadow-red-500/30 ring-2 ring-red-400/50'
              : 'bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-white/15'
          }`}
          title="Activa el zoom per inspeccionar la millora de textura i nitidesa al detall"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <span>{isZoomed ? 'Zoom 2.5x Actiu (Mou el cursor)' : 'Lupa Detalls (2.5x)'}</span>
        </button>
      </div>

      {/* Contenidor del Slider */}
      <div
        ref={containerRef}
        role="slider"
        aria-valuenow={Math.round(ariaPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Comparació d'imatges abans i després"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMoveOverContainer}
        className="relative overflow-hidden rounded-2xl border border-slate-300 dark:border-slate-800 bg-slate-900 shadow-2xl cursor-col-resize select-none focus:outline-none focus:ring-2 focus:ring-red-400 group"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          updatePosition(((e.clientX - rect.left) / rect.width) * 100);
          setIsDragging(true);
        }}
      >
        {/* BADGE ESQUERRA: NOU (UPSCALED) */}
        <div className="pointer-events-none absolute top-3 left-3 z-30 flex items-center gap-1.5 rounded-full bg-slate-950/80 backdrop-blur-md px-3 py-1 text-[11px] font-bold text-white border border-red-500/50 shadow-lg">
          <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span>NOU (4x)</span>
          {dimensions.processed && (
            <span className="text-[10px] font-mono text-red-300 font-normal">
              {dimensions.processed.width}×{dimensions.processed.height}
            </span>
          )}
        </div>

        {/* BADGE DRETA: ANTIC (ORIGINAL) */}
        <div className="pointer-events-none absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full bg-slate-950/80 backdrop-blur-md px-3 py-1 text-[11px] font-bold text-slate-300 border border-white/15 shadow-lg">
          <span>ANTIC (Original)</span>
          {dimensions.original && (
            <span className="text-[10px] font-mono text-slate-400 font-normal">
              {dimensions.original.width}×{dimensions.original.height}
            </span>
          )}
        </div>

        {/* CONTENIDOR AMB ZOOM CAPACITAT */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
            transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
          {/* Imatge Original (Fons / Part dreta) */}
          <img
            src={originalSrc}
            alt="Original abans del procés"
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              setDimensions((prev) => ({ ...prev, original: { width: naturalWidth, height: naturalHeight } }));
            }}
            className="block w-full h-auto object-contain pointer-events-none"
            draggable={false}
          />

          {/* Imatge Processada (Part esquerra retallada) */}
          <div
            ref={clipRef}
            className="absolute inset-0 z-10"
            style={{
              clipPath: `inset(0 ${100 - positionRef.current}% 0 0)`,
            }}
          >
            <img
              src={processedSrc}
              alt="Processada després del procés"
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                setDimensions((prev) => ({ ...prev, processed: { width: naturalWidth, height: naturalHeight } }));
              }}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              draggable={false}
            />
          </div>

          {/* SLIDER HANDLE */}
          <div
            ref={handleRef}
            className="absolute inset-y-0 z-20 flex items-center justify-center w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,0.8)]"
            style={{ left: `${positionRef.current}%` }}
          >
            <div className="absolute flex items-center justify-center w-8 h-8 md:w-9 md:h-9 bg-white dark:bg-slate-900 rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.6)] border border-slate-300 dark:border-white/20 text-slate-700 dark:text-slate-200 transition-transform duration-200 ease-out group-hover:scale-110 group-active:scale-95">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18-6-6 6-6" />
                <path d="m15 6 6 6-6 6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Barra d'informació de resolució */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.03] px-3.5 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500 dark:text-slate-400">ANTIC:</span>
          <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">
            {dimensions.original ? `${dimensions.original.width} × ${dimensions.original.height} px` : '...'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-red-600 dark:text-red-400 font-bold text-[11px] ring-1 ring-red-500/20">
          <span>⚡ Resolució 4x (+16x píxels)</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-red-600 dark:text-red-400">NOU:</span>
          <span className="font-mono text-slate-900 dark:text-white font-bold">
            {dimensions.processed ? `${dimensions.processed.width} × ${dimensions.processed.height} px` : '...'}
          </span>
        </div>
      </div>
    </div>
  );
}