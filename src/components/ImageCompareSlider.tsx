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
  const [isHovered, setIsHovered] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [sliderPos, setSliderPos] = useState(50);
  
  const [dimensions, setDimensions] = useState<{
    original: { width: number; height: number } | null;
    processed: { width: number; height: number } | null;
  }>({ original: null, processed: null });

  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  
  const positionRef = useRef(50);
  const frameIdRef = useRef<number | null>(null);
  
  const [ariaPosition, setAriaPosition] = useState(50);

  const updatePosition = (value: number) => {
    const clamped = Math.min(100, Math.max(0, value));
    positionRef.current = clamped;
    setSliderPos(clamped);
    
    if (clipRef.current) {
      clipRef.current.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    }
    if (handleRef.current) {
      handleRef.current.style.left = `${clamped}%`;
    }
  };

  // Initial reveal animation
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

  // Drag handling
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

  const showLabels = isDragging || isHovered;

  return (
    <div className="w-full flex flex-col gap-3 transition-all duration-300">
      {/* Top action / control bar */}
      <div className="flex items-center justify-between px-1">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <span className="flex h-1.5 w-1.5 rounded-full bg-red-500/80 animate-pulse" />
          <span>Drag slider to compare before & after</span>
        </div>

        <button
          type="button"
          onClick={() => setIsZoomed(!isZoomed)}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 shadow-sm ${
            isZoomed
              ? 'bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.4)] ring-1 ring-red-400'
              : 'bg-white/80 dark:bg-white/[0.05] text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/10 hover:border-red-500/30 hover:bg-slate-100 dark:hover:bg-white/[0.08] backdrop-blur-sm'
          }`}
          title="Inspect fine details with interactive 2.5x zoom lens"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <span>{isZoomed ? 'Exit Zoom (2.5x)' : 'Inspect 2.5x Zoom'}</span>
        </button>
      </div>

      {/* Main Slider Container */}
      <div
        ref={containerRef}
        role="slider"
        aria-valuenow={Math.round(ariaPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Image comparison before and after"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        onPointerMove={handlePointerMoveOverContainer}
        className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-[#060a10] shadow-xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.6)] cursor-col-resize select-none focus:outline-none focus:ring-2 focus:ring-red-500/50 group"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          updatePosition(((e.clientX - rect.left) / rect.width) * 100);
          setIsDragging(true);
        }}
      >
        {/* Dynamic Badge: Upscaled (fades in on drag/hover and fades out when idle or covered) */}
        <div
          className={`pointer-events-none absolute top-3.5 left-3.5 z-30 flex items-center gap-1.5 rounded-full bg-black/60 dark:bg-black/75 backdrop-blur-md px-3 py-1 text-[11px] font-semibold text-white border border-red-500/30 shadow-lg transition-all duration-300 ${
            showLabels && sliderPos > 18
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-1'
          }`}
        >
          <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span>Upscaled (4x)</span>
          {dimensions.processed && (
            <span className="text-[10px] font-mono text-red-300/80 font-normal">
              {dimensions.processed.width}×{dimensions.processed.height}
            </span>
          )}
        </div>

        {/* Dynamic Badge: Original (fades in on drag/hover and fades out when idle or covered) */}
        <div
          className={`pointer-events-none absolute top-3.5 right-3.5 z-30 flex items-center gap-1.5 rounded-full bg-black/60 dark:bg-black/75 backdrop-blur-md px-3 py-1 text-[11px] font-medium text-slate-300 border border-white/10 shadow-lg transition-all duration-300 ${
            showLabels && sliderPos < 82
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-1'
          }`}
        >
          <span>Original</span>
          {dimensions.original && (
            <span className="text-[10px] font-mono text-slate-400 font-normal">
              {dimensions.original.width}×{dimensions.original.height}
            </span>
          )}
        </div>

        {/* Zoomable Image Wrapper */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            transform: isZoomed ? 'scale(2.5)' : 'scale(1)',
            transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
          {/* Original image (Background layer) */}
          <img
            src={originalSrc}
            alt="Original before upscaling"
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              setDimensions((prev) => ({ ...prev, original: { width: naturalWidth, height: naturalHeight } }));
            }}
            className="block w-full h-auto object-contain pointer-events-none"
            draggable={false}
          />

          {/* Upscaled image (Clipped foreground layer) */}
          <div
            ref={clipRef}
            className="absolute inset-0 z-10"
            style={{
              clipPath: `inset(0 ${100 - positionRef.current}% 0 0)`,
            }}
          >
            <img
              src={processedSrc}
              alt="Upscaled after processing"
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                setDimensions((prev) => ({ ...prev, processed: { width: naturalWidth, height: naturalHeight } }));
              }}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              draggable={false}
            />
          </div>

          {/* Slider Handle Divider */}
          <div
            ref={handleRef}
            className="absolute inset-y-0 z-20 flex items-center justify-center w-[2px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.9),0_0_20px_rgba(239,68,68,0.5)]"
            style={{ left: `${positionRef.current}%` }}
          >
            {/* Center Thumb Disc */}
            <div className={`relative flex items-center justify-center w-8 h-8 rounded-full bg-white dark:bg-[#0b1220] border border-slate-200 dark:border-white/20 text-slate-700 dark:text-white shadow-xl transition-all duration-150 ${
              isDragging ? 'scale-110 ring-4 ring-red-500/25 shadow-red-500/20' : 'group-hover:scale-105'
            }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18-6-6 6-6"/>
                <path d="m15 6 6 6-6 6"/>
              </svg>
            </div>

            {/* Quick floating label attached above the handle on drag */}
            <div className={`pointer-events-none absolute -top-8 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-950/90 backdrop-blur-md text-[10px] font-semibold text-white border border-white/15 shadow-xl transition-all duration-200 whitespace-nowrap ${
              isDragging ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}>
              <span className="text-red-400 font-bold">Upscaled</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">Original</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sleek bottom resolution bar styled like the rest of the site */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.03] backdrop-blur-sm px-4 py-2.5 shadow-sm dark:shadow-none transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Original</span>
          <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
            {dimensions.original ? `${dimensions.original.width} × ${dimensions.original.height} px` : '—'}
          </span>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 dark:bg-red-500/15 px-3 py-1 text-[11px] font-medium text-red-700 dark:text-red-300 ring-1 ring-red-500/20">
          <span className="h-1 w-1 rounded-full bg-red-500 dark:bg-red-400" />
          <span>Real-ESRGAN 4x · 16x pixels</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500 dark:text-red-400">Upscaled</span>
          <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
            {dimensions.processed ? `${dimensions.processed.width} × ${dimensions.processed.height} px` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}