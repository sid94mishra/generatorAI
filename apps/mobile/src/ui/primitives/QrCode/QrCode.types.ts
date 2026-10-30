// MP-50 QrCode contract (03 MP-50).
export interface QrCodeProps {
  /** The payload (pairing link). */
  value: string;
  /** Default 200. */
  size?: number;
  /** Accessible name ("Pairing QR code"). */
  label: string;
  testID?: string;
}
