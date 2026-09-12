import { useRef, useState, DragEvent, ChangeEvent } from 'react';

export type DropzoneProps = {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
};

export function Dropzone({ onFileSelected, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    onFileSelected(file);
  };

  const onDragOver  = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (!disabled) setIsDragOver(true); };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragOver(false); };
  const onDrop      = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(false);
    handleFiles(e.dataTransfer?.files ?? null);
  };
  const onChange    = (e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files);
  const openDialog  = () => { if (!disabled) inputRef.current?.click(); };

  return (
    <div className="w-full">
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={onChange} />
      <div
        onClick={openDialog}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          'group relative flex h-52 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border transition-all duration-200',
          disabled
            ? 'cursor-not-allowed border-white/[0.04] opacity-50'
            : isDragOver
            ? 'border-cyan-400/50 bg-cyan-400/[0.04] ring-1 ring-cyan-400/20'
            : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.03]',
        ].join(' ')}
      >
        {/* Upload icon */}
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-all duration-200 ${
          isDragOver
            ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-400'
            : 'border-white/[0.08] bg-white/[0.04] text-slate-500 group-hover:border-white/[0.14] group-hover:text-slate-400'
        }`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>

        <div className="text-center">
          <p className={`text-sm font-medium transition-colors ${isDragOver ? 'text-cyan-300' : 'text-slate-300 group-hover:text-slate-200'}`}>
            {isDragOver ? 'Drop to upload' : 'Drop an image here'}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">or click to browse · PNG, JPG, WEBP</p>
        </div>
      </div>
    </div>
  );
}