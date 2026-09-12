/**
 * Merges the AI-generated result with the user's hand-drawn correction mask.
 *
 * The overlay canvas stores:
 *   · white  (brightness > 128, a > 0) → RESTORE: takes RGB from original
 *   · black  (brightness ≤ 128, a > 0) → ERASE:   forces transparent
 *   · transparent (a === 0)             → keep AI decision
 *
 * Key: in RESTORE mode we take RGB from `originalImageData`, not from `aiResult`,
 * because where the AI removed the background, aiResult pixels are (0,0,0,0).
 */
export function refineMask(
  aiResult: ImageData,
  originalImageData: ImageData,
  correctionMask: ImageData
): ImageData {
  if (
    aiResult.width !== correctionMask.width ||
    aiResult.height !== correctionMask.height
  ) {
    throw new Error('refineMask: dimensions do not match');
  }

  const out = new ImageData(
    new Uint8ClampedArray(aiResult.data),
    aiResult.width,
    aiResult.height
  );

  const orig = originalImageData.data;
  const mask = correctionMask.data;
  const result = out.data;

  for (let i = 0; i < result.length; i += 4) {
    const maskA = mask[i + 3];
    if (maskA === 0) continue; // no painting → AI decision

    const brightness = (mask[i] + mask[i + 1] + mask[i + 2]) / 3;

    if (brightness > 128) {
      // RESTORE: pixels from the ORIGINAL image (has real colors, not zeros)
      result[i]     = orig[i];
      result[i + 1] = orig[i + 1];
      result[i + 2] = orig[i + 2];
      result[i + 3] = 255;
    } else {
      // ERASE: completely transparent
      result[i]     = 0;
      result[i + 1] = 0;
      result[i + 2] = 0;
      result[i + 3] = 0;
    }
  }

  return out;
} 