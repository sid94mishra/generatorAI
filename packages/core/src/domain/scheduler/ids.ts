// ────────────────────────────────────────────────────────────────
// Deterministic ids for the scheduler (P03 WP-3.3, G5 §5.3).
//
// `decide()` must produce byte-identical decisions when replayed, so every
// id it mints is a UUIDv5 (RFC 9562 §5.5: SHA-1 of a namespace and a name)
// of what the row IS: an instance is (run, instance path), an attempt is
// (instance, attempt number), a timer is (run, instance, kind, the version
// of the row that armed it).
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/** The scheduler's UUIDv5 namespace (a fixed random UUID). */
export const SCHEDULER_NAMESPACE = '7c0f5f53-3d5e-4d8a-9f39-2b1f6a0c9e41';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 9562 UUIDv5 of `name` in `namespace`. */
export function uuidv5(name: string, namespace: string = SCHEDULER_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidBytes(namespace)).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function instanceId(runId: string, instancePath: string): string {
  return uuidv5(`instance:${runId}:${instancePath}`);
}

export function attemptId(stageRunId: string, attemptNo: number): string {
  return uuidv5(`attempt:${stageRunId}:${attemptNo}`);
}

export function timerId(runId: string, stageRunId: string | null, kind: string, armedAtVersion: number): string {
  return uuidv5(`timer:${runId}:${stageRunId ?? ''}:${kind}:${armedAtVersion}`);
}
