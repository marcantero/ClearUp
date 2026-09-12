export type LoadedImage = {
  imageData: ImageData;
  dataUrl: string;
};

export async function fileToImageData(
  file: File,
  maxSize = 1024,
): Promise<LoadedImage> {
  const imageUrl = URL.createObjectURL(file);

  const img = await loadImage(imageUrl);
  const { width, height } = getScaledSize(img.width, img.height, maxSize);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(imageUrl);
    throw new Error('Could not get 2D context');
  }

  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/png');
  URL.revokeObjectURL(imageUrl);

  return { imageData, dataUrl };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function getScaledSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  const maxDim = Math.max(width, height);
  if (maxDim <= maxSize) {
    return { width, height };
  }

  const scale = maxSize / maxDim;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context');
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function imageDataToPngBlob(
  imageData: ImageData,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get 2D context');
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create PNG blob'));
    }, 'image/png');
  });
}
