import { useCallback } from 'react';

export type SmartBrushMode = 'restore' | 'erase';

interface SmartBrushResult {
  pixelCount: number;
}

/**
 * useSmartBrush — Region Growing restringit per radi espacial.
 *
 * Com el Quick Selection / Object Selection de Photoshop:
 *   - Pren el color del píxel seed (punt actual del pinzell)
 *   - Expandeix per 4-connectivitat als veïns dins tolerància RGB
 *   - PERÒ mai ultrapassa `radius` píxels de distància euclidiana
 *     des del centre seed → la selecció queda ancorada al pinzell
 *
 * S'acumula de forma incremental en els canvas ocults de useMaskEditor,
 * exactament igual que paintSegment fa per al pinzell normal.
 * Cada crida pinta només la delta nova (no esborra el que ja hi havia).
 */
export function useSmartBrush() {

  /**
   * @param sourceImageData - Imatge de referència per al mostreig de color
   *                          (preferiblement originalImageData per tenir RGB reals)
   * @param maskCanvas      - Canvas ocult (restoreCanvas o eraseCanvas de useMaskEditor)
   * @param overlayCanvas   - Canvas visible que veu l'usuari
   * @param seedX           - Coordenada X en píxels interns (ja escalada)
   * @param seedY           - Coordenada Y en píxels interns (ja escalada)
   * @param radius          - Radi màxim d'expansió en píxels (lligat al brushSize de la UI)
   * @param tolerance       - Distància euclidiana RGB màxima per expandir (0–441)
   * @param mode            - 'restore' | 'erase'
   * @param globalVisited   - Uint8Array compartit entre crida i crida durant un stroke,
   *                          perquè els píxels ja pintats no es repintin ni es re-analitzin
   */
  const fillAt = useCallback(
    (
      sourceImageData: ImageData,
      maskCanvas: HTMLCanvasElement,
      overlayCanvas: HTMLCanvasElement,
      seedX: number,
      seedY: number,
      radius: number,
      tolerance: number,
      mode: SmartBrushMode,
      globalVisited: Uint8Array,
    ): SmartBrushResult => {
      const { width: w, height: h, data: src } = sourceImageData;

      const sx = Math.max(0, Math.min(w - 1, Math.round(seedX)));
      const sy = Math.max(0, Math.min(h - 1, Math.round(seedY)));

      // Mostreig del color seed des de la imatge original (té RGB reals, no zeros)
      const seedIdx = (sy * w + sx) * 4;
      const seedR = src[seedIdx];
      const seedG = src[seedIdx + 1];
      const seedB = src[seedIdx + 2];

      const tolSq    = tolerance * tolerance;
      const radiusSq = radius * radius;

      // Visited local per aquest fill (per no entrar en bucle sobre el BFS)
      // però usem globalVisited per saltar píxels ja pintats en strokes anteriors
      const localVisited = new Uint8Array(w * h);

      // Delta de píxels nous d'aquest fill (ImageData parcial per composar)
      // Fem servir un canvas temporal petit encuadrat al bounding box del radi
      // per evitar alocar w×h en cada segment
      const minX = Math.max(0, sx - radius);
      const minY = Math.max(0, sy - radius);
      const maxX = Math.min(w - 1, sx + radius);
      const maxY = Math.min(h - 1, sy + radius);
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;

      // Màscara temporal del bounding box
      const maskBuf  = new Uint8ClampedArray(bw * bh * 4); // transparent per defecte
      const overBuf  = new Uint8ClampedArray(bw * bh * 4);

      // BFS sobre el bounding box
      const queue = new Int32Array(bw * bh * 2);
      let head = 0, tail = 0;

      const enqueue = (px: number, py: number) => {
        const gi = py * w + px; // índex global
        if (localVisited[gi]) return;
        localVisited[gi] = 1;
        queue[tail++] = px;
        queue[tail++] = py;
      };

      enqueue(sx, sy);

      let pixelCount = 0;

      while (head < tail) {
        const px = queue[head++];
        const py = queue[head++];

        // Restricció espacial: radi euclidià des del seed
        const dx = px - sx;
        const dy = py - sy;
        if (dx * dx + dy * dy > radiusSq) continue;

        // Restricció cromàtica
        const pi = (py * w + px) * 4;
        const dr = src[pi]     - seedR;
        const dg = src[pi + 1] - seedG;
        const db = src[pi + 2] - seedB;
        if (dr * dr + dg * dg + db * db > tolSq) continue;

        // Ja estava pintat en un stroke anterior → saltar (però sí propagar veïns)
        const gi = py * w + px;
        if (!globalVisited[gi]) {
          globalVisited[gi] = 1;
          pixelCount++;

          // Índex dins del bounding box
          const bi = ((py - minY) * bw + (px - minX)) * 4;

          if (mode === 'restore') {
            maskBuf[bi] = 255; maskBuf[bi+1] = 255; maskBuf[bi+2] = 255; maskBuf[bi+3] = 255;
            overBuf[bi] = 52;  overBuf[bi+1] = 211; overBuf[bi+2] = 153; overBuf[bi+3] = 115;
          } else {
            maskBuf[bi] = 0;   maskBuf[bi+1] = 0;   maskBuf[bi+2] = 0;   maskBuf[bi+3] = 255;
            overBuf[bi] = 0;   overBuf[bi+1] = 0;   overBuf[bi+2] = 0;   overBuf[bi+3] = 255;
          }
        }

        // 4-veïns (dins bounds)
        if (px > 0)     enqueue(px - 1, py);
        if (px < w - 1) enqueue(px + 1, py);
        if (py > 0)     enqueue(px, py - 1);
        if (py < h - 1) enqueue(px, py + 1);
      }

      if (pixelCount === 0) return { pixelCount: 0 };

      // ── Composar delta al canvas de màscara ocult ──────────────────────
      const mCtx = maskCanvas.getContext('2d');
      if (mCtx) {
        const tmp = document.createElement('canvas');
        tmp.width = bw; tmp.height = bh;
        tmp.getContext('2d')!.putImageData(new ImageData(maskBuf, bw, bh), 0, 0);
        mCtx.save();
        mCtx.globalCompositeOperation = 'source-over';
        mCtx.drawImage(tmp, minX, minY);
        mCtx.restore();
      }

      // ── Composar delta al canvas d'overlay visible ─────────────────────
      const oCtx = overlayCanvas.getContext('2d');
      if (oCtx) {
        const tmp = document.createElement('canvas');
        tmp.width = bw; tmp.height = bh;
        tmp.getContext('2d')!.putImageData(new ImageData(overBuf, bw, bh), 0, 0);
        oCtx.save();
        oCtx.globalCompositeOperation = mode === 'restore' ? 'source-over' : 'destination-out';
        oCtx.drawImage(tmp, minX, minY);
        oCtx.restore();
      }

      return { pixelCount };
    },
    [],
  );

  /** Crea un globalVisited nou per a cada stroke (onPointerDown) */
  const createStrokeState = useCallback(
    (width: number, height: number): Uint8Array => new Uint8Array(width * height),
    [],
  );

  /** Converteix un event de ratolí a coordenades en píxels interns del canvas */
  const getScaledPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width  / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height),
      };
    },
    [],
  );

  return { fillAt, createStrokeState, getScaledPos };
}