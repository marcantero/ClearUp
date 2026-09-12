export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ModelStatusBannerProps = {
  status: ModelStatus;
  message?: string;
  progress?: number;
  phase?: string;
};

export function ModelStatusBanner({ status, message, progress, phase }: ModelStatusBannerProps) {
  if (status === 'idle') return null;

  const isError   = status === 'error';
  const isLoading = status === 'loading';
  const isReady   = status === 'ready';

  const clamped = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : undefined;
  const barW    = clamped != null ? `${Math.max(5, clamped)}%` : '30%';
  const phaseLabel = phase?.trim().length ? phase : 'Downloading AI model';

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm animate-[fade-in_220ms_ease-out_forwards] ${
      isError   ? 'border-red-500/25 bg-red-500/[0.07] text-red-200'
      : isLoading ? 'border-amber-500/25 bg-amber-500/[0.07] text-amber-200'
      :             'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-200'
    }`}>
      <span className="mt-px text-base leading-none">
        {isError ? '⚠' : isLoading ? '⏳' : '✓'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[13px]">
          {isError   ? 'Error loading the AI model'
          : isLoading ? 'Loading AI model…'
          :             'AI model ready'}
        </p>
        <p className="mt-0.5 text-[11px] opacity-70">
          {message ?? (
            isError   ? 'Reload the page or try again later.'
            : isLoading ? 'The model downloads once and runs on-device. Keep this tab open.'
            :             'Your images never leave this device.'
          )}
        </p>
        {isLoading && (
          <div className="mt-2.5 space-y-1">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-[width] duration-300 ease-out"
                style={{ width: barW }}
              />
            </div>
            <p className="text-[10px] uppercase tracking-wider opacity-60">
              {phaseLabel}{clamped != null ? ` · ${Math.round(clamped)}%` : '…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}