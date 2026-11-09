// ────────────────────────────────────────────────────────────────
// Device stream frames → WebCodecs (docs/devices DV-5). Pure helpers.
//
// The socket uses the screencast's 16-byte header (`screencastFrame.ts`);
// devices add two codecs: 2 = H.264 AVCC (iOS, configured with the avcC
// record) and 3 = H.264 Annex-B (Android, SPS/PPS in band). Flag bit 1 marks
// the decoder configuration.
// ────────────────────────────────────────────────────────────────

import { DEVICE_FRAME_CODEC, DEVICE_FRAME_FLAG } from '@generatorai/shared';
import { parseScreencastFrame, type ScreencastFrame } from '@/blocks/browser/screencastFrame.js';

export interface DeviceFrame extends ScreencastFrame {
  config: boolean;
}

export function parseDeviceFrame(buffer: ArrayBuffer): DeviceFrame | null {
  const frame = parseScreencastFrame(buffer);
  if (!frame) return null;
  const flags = new DataView(buffer).getUint8(3);
  return { ...frame, config: (flags & DEVICE_FRAME_FLAG.config) !== 0 };
}

const hex = (n: number): string => n.toString(16).padStart(2, '0');

/** `avc1.PPCCLL` from an avcC record (iOS config frame). */
export function codecFromAvcc(avcc: Uint8Array): string | null {
  if (avcc.length < 4 || avcc[0] !== 1) return null;
  return `avc1.${hex(avcc[1]!)}${hex(avcc[2]!)}${hex(avcc[3]!)}`;
}

/** NAL units of an Annex-B stream (start codes 00 00 01 / 00 00 00 01). */
export function annexBNalUnits(data: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) units.push(data.subarray(start, i > 0 && data[i - 1] === 0 ? i - 1 : i));
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0 && start < data.length) units.push(data.subarray(start));
  return units;
}

/** `avc1.PPCCLL` from the SPS in an Annex-B config packet (Android). */
export function codecFromAnnexB(config: Uint8Array): string | null {
  const sps = annexBNalUnits(config).find((nal) => (nal[0]! & 0x1f) === 7);
  if (!sps || sps.length < 4) return null;
  return `avc1.${hex(sps[1]!)}${hex(sps[2]!)}${hex(sps[3]!)}`;
}

export const isH264 = (codec: number): boolean => codec === DEVICE_FRAME_CODEC.h264Avcc || codec === DEVICE_FRAME_CODEC.h264AnnexB;

/** Joins byte arrays (Annex-B keyframes get their SPS/PPS prepended). */
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
