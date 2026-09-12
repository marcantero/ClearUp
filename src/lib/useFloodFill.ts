import { useCallback, useRef } from 'react';

export type FloodFillMode = 'restore' | 'erase';

interface FloodFillResult {
  /** Pixels affected by this fill, as a flat [x, y, x, y, ...] list */
  pixelCount: number;
  /** The merged ImageData ready to pass to getCorrectionMask-compatible consumers */
  maskImageData: ImageData;
}

/**
 * useFloodFill — Region Growing (4-connected BFS flood fill) on an ImageData source.
 *
 * Samples the RGB of the seed pixel from `sourceImageData` and expands
 * to all 4-connected neighbours whose Euclidean RGB distance is within
 * `tolerance`.  The result is written onto a caller-supplied canvas so it
 * integrates naturally with useMaskEditor's restoreCanvas / eraseCanvas
 * architecture.
 *
 * The hook is intentionally pure-logic: it owns no canvas refs of its own.
 * The caller passes the hidden mask canvas (restore or erase) and the
 * visible overlay canvas so the hook can paint both in one synchronous pass,
 * matching the behaviour of useMaskEditor's paintSegment.
 */
export function useFloodFill() {
  const abortRef = useRef(false);

  /**
   * Performs a synchronous BFS flood fill.
   *
   * @param sourceImageData  - The image to sample seed colour from
   *                           (typically the AI result or original)
   * @param maskCanvas       - Hidden canvas to accumulate the mask
   *                           (white for restore, black for erase)
   * @param overlayCanvas    - Visible canvas the user sees
   * @param seedX            - Canvas pixel X of the click (already scaled)
   * @param seedY            - Canvas pixel Y of the click (already scaled)
   * @param tolerance        - Euclidean RGB distance threshold (0–441)
   * @param mode             - 'restore' → white on mask / green on overlay
   *                           'erase'   → black on mask / punch-through on overlay
   */
  const fill = useCallback(
    (
      sourceImageData: ImageData,
      maskCanvas: HTMLCanvasElement,
      overlayCanvas: HTMLCanvasElement,
      seedX: number,
      seedY: number,
      tolerance: number,
      mode: FloodFillMode,
    ): FloodFillResult | null => {
      const { width: w, height: h, data: src } = sourceImageData;

      // Clamp seed coords
      const sx = Math.max(0, Math.min(w - 1, Math.round(seedX)));
      const sy = Math.max(0, Math.min(h - 1, Math.round(seedY)));

      // Sample seed colour from the source image
      const seedIdx = (sy * w + sx) * 4;
      const seedR = src[seedIdx];
      const seedG = src[seedIdx + 1];
      const seedB = src[seedIdx + 2];

      // Build a visited bitmask (1 bit per pixel)
      const visited = new Uint8Array(w * h);
      // Output mask buffer — same dimensions as source
      const maskOut = new ImageData(w, h);
      const maskData = maskOut.data;

      // BFS queue — pre-allocate a flat [x, y] typed array big enough for worst case
      const queue = new Int32Array(w * h * 2);
      let head = 0;
      let tail = 0;

      queue[tail++] = sx;
      queue[tail++] = sy;
      visited[sy * w + sx] = 1;

      let pixelCount = 0;
      const tolSq = tolerance * tolerance;

      while (head < tail) {
        const px = queue[head++];
        const py = queue[head++];

        const pi = (py * w + px) * 4;
        const dr = src[pi]     - seedR;
        const dg = src[pi + 1] - seedG;
        const db = src[pi + 2] - seedB;
        const distSq = dr * dr + dg * dg + db * db;

        if (distSq > tolSq) continue;

        // Mark this pixel in the output mask
        if (mode === 'restore') {
          maskData[pi]     = 255;
          maskData[pi + 1] = 255;
          maskData[pi + 2] = 255;
          maskData[pi + 3] = 255;
        } else {
          maskData[pi]     = 0;
          maskData[pi + 1] = 0;
          maskData[pi + 2] = 0;
          maskData[pi + 3] = 255;
        }
        pixelCount++;

        // Push 4-connected neighbours
        const neighbours: [number, number][] = [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni]) continue;
          visited[ni] = 1;
          queue[tail++] = nx;
          queue[tail++] = ny;
        }
      }

      if (pixelCount === 0) return null;

      // ── Paint the hidden mask canvas (source-over) ─────────────────────
      const mCtx = maskCanvas.getContext('2d');
      if (mCtx) {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width  = w;
        tmpCanvas.height = h;
        const tmpCtx = tmpCanvas.getContext('2d');
        if (tmpCtx) {
          tmpCtx.putImageData(maskOut, 0, 0);
          mCtx.save();
          mCtx.globalCompositeOperation = 'source-over';
          mCtx.drawImage(tmpCanvas, 0, 0);
          mCtx.restore();
        }
      }

      // ── Paint the visible overlay canvas ───────────────────────────────
      const oCtx = overlayCanvas.getContext('2d');
      if (oCtx) {
        const oCanvas = document.createElement('canvas');
        oCanvas.width  = w;
        oCanvas.height = h;
        const oCCtx = oCanvas.getContext('2d');
        if (oCCtx) {
          // Build an overlay-coloured version of the same mask
          const overlayImageData = new ImageData(w, h);
          const od = overlayImageData.data;
          for (let i = 0; i < maskData.length; i += 4) {
            if (maskData[i + 3] === 0) continue; // untouched
            if (mode === 'restore') {
              // Semi-transparent green (matches paintSegment)
              od[i]     = 52;
              od[i + 1] = 211;
              od[i + 2] = 153;
              od[i + 3] = 115; // ~0.45 * 255
            } else {
              // For erase we punch through the overlay with destination-out
              od[i]     = 0;
              od[i + 1] = 0;
              od[i + 2] = 0;
              od[i + 3] = 255;
            }
          }
          oCCtx.putImageData(overlayImageData, 0, 0);

          oCtx.save();
          if (mode === 'restore') {
            oCtx.globalCompositeOperation = 'source-over';
          } else {
            oCtx.globalCompositeOperation = 'destination-out';
          }
          oCtx.drawImage(oCanvas, 0, 0);
          oCtx.restore();
        }
      }

      return { pixelCount, maskImageData: maskOut };
    },
    [],
  );

  /**
   * Converts a mouse event position on a canvas to the scaled pixel
   * coordinates within the canvas's internal resolution — identical
   * to getScaledPos in useMaskEditor so both tools share the same
   * coordinate space.
   */
  const getScaledPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top)  * scaleY,
      };
    },
    [],
  );

  return { fill, getScaledPos };
}
