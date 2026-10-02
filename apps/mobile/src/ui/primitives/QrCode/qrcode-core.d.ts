// Types for the pure encoder core of `qrcode` (the package's own typings
// only cover the Node/browser renderers). See `qrMatrix.ts`.
declare module 'qrcode/lib/core/qrcode' {
  export interface QrBitMatrix {
    size: number;
    get(row: number, col: number): number | boolean;
  }
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; version?: number },
  ): { modules: QrBitMatrix; version: number };
}
