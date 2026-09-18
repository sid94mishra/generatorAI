// ────────────────────────────────────────────────────────────────
// QR matrix — text in, module grid out.
//
// The encoder is `qrcode`'s core (`qrcode/lib/core/qrcode`), the same
// well-tested library the web app renders its pairing QR with. Only the
// core is imported: it is pure JS with no canvas, DOM or Node dependency, so
// it runs unchanged on Hermes and the web preview. Drawing is left to
// `QrCode.tsx` (react-native-svg).
// ────────────────────────────────────────────────────────────────

import { create } from 'qrcode/lib/core/qrcode';

export interface QrMatrix {
  size: number;
  /** Row-major: `cells[row * size + col]` is true for a dark module. */
  cells: boolean[];
}

export function qrMatrix(text: string, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix {
  const { modules } = create(text, { errorCorrectionLevel });
  const cells: boolean[] = new Array(modules.size * modules.size);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      cells[row * modules.size + col] = Boolean(modules.get(row, col));
    }
  }
  return { size: modules.size, cells };
}

/**
 * One SVG path for all dark modules, merging horizontal runs so a v10 code is
 * a few hundred segments rather than thousands of `<Rect>` nodes.
 */
export function qrPath(matrix: QrMatrix, margin = 0): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.cells[row * matrix.size + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.cells[row * matrix.size + col]) col++;
      parts.push(`M${start + margin} ${row + margin}h${col - start}v1h${start - col}z`);
    }
  }
  return parts.join('');
}
