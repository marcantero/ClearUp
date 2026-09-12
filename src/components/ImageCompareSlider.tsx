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
  
  // 1. Refs pels elements del DOM que animarem manualment
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  
  // 2. Ref per guardar la posició sense provocar re-renders
  const positionRef = useRef(50);
  const frameIdRef = useRef<number | null>(null);
  
  // 3. Estat només per a l'accessibilitat (s'actualitza un sol cop al final)
  const [ariaPosition, setAriaPosition] = useState(50);

  // Aquesta funció muta el DOM directament. És ultra-ràpida i Zero-Lag.
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
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const value = 5 + eased * 45; 
      
      updatePosition(value);

      if (t < 1) {
        frameIdRef.current = requestAnimationFrame(step);
      } else {
        // Al final de l'animació, guardem l'estat per al lector de pantalles
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
    
    // 4. OPTIMITZACIÓ: Calculem el BoundingRect només una vegada al principi.
    // Fer-ho dins del 'pointermove' ralentia molt el navegador.
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

  // Accessibilitat (Teclat)
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
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-4 transition-transform duration-500 ease-out">
      <div
        ref={containerRef}
        role="slider"
        aria-valuenow={Math.round(ariaPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Comparació d'imatges abans i després"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl cursor-col-resize select-none focus:outline-none focus:ring-2 focus:ring-cyan-400 group transition-transform duration-300 ease-out hover:scale-[1.01] hover:shadow-[0_22px_70px_rgba(15,23,42,0.95)]"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          updatePosition(((e.clientX - rect.left) / rect.width) * 100);
          setIsDragging(true);
        }}
      >
        <img
          src={originalSrc}
          alt="Original abans del procés"
          className="block w-full h-auto object-contain pointer-events-none transition-transform duration-500 ease-out group-hover:scale-[1.01]"
          draggable={false}
        />

        {/* CONTENIDOR PROCESSADA -> Hi afegim la Ref */}
        <div
          ref={clipRef}
          className="absolute inset-0 z-10"
          style={{
            backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px',
            backgroundColor: '#f9fafb',
            clipPath: `inset(0 ${100 - positionRef.current}% 0 0)`, // S'inicialitza amb el ref
          }}
        >
          <img
            src={processedSrc}
            alt="Processada després del procés"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none transition-transform duration-500 ease-out group-hover:scale-[1.01]"
            draggable={false}
          />
        </div>

        {/* SLIDER HANDLE -> Hi afegim la Ref */}
        <div
          ref={handleRef}
          className="absolute inset-y-0 z-20 flex items-center justify-center w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]"
          style={{ left: `${positionRef.current}%` }} // S'inicialitza amb el ref
        >
          <div className="absolute flex items-center justify-center w-8 h-8 md:w-10 md:h-10 bg-white rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.3)] border border-slate-200 text-slate-600 transition-transform duration-200 ease-out group-hover:scale-110 group-active:scale-95">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18-6-6 6-6" />
              <path d="m15 6 6 6-6 6" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}