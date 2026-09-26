// ────────────────────────────────────────────────────────────────
// WorktreeLeases — writer exclusion on the run mounts while a
// `mount_per_item` map runs (P05 §4.1).
//
// One lease key per run mount, `worktree:<mountId>`, three modes:
//   shared     a running mount_per_item map (its items work in their own
//              worktrees cut from a snapshot of this mount; nothing may
//              change the mount under the snapshot until the merges)
//   write      a stage OUTSIDE such a map that may write the mount (every
//              agent and check launch of the run that is not inside a
//              mount_per_item item); writers do not exclude each other —
//              parallel stages of one run always shared their mounts
//   exclusive  a map's merge into the mount; compatible only with the same
//              map's own shared lease
//
//              shared   write   exclusive (other owner)
//   shared       ok      wait        wait
//   write       wait      ok         wait
//   exclusive   wait*    wait        wait        (* ok for the owner's own shared)
//
// Requests are granted in FIFO order per key, so a waiting map snapshot is
// not starved by a stream of writers. The leases are process-local like the
// engine lock; recovery re-takes the shared leases of the running maps.
// ────────────────────────────────────────────────────────────────

export type LeaseMode = 'shared' | 'write' | 'exclusive';

interface Holder {
  owner: string;
  mode: LeaseMode;
}

interface Waiter {
  owner: string;
  mode: LeaseMode;
  keys: string[];
  grant: () => void;
}

export const worktreeLeaseKey = (mountId: string) => `worktree:${mountId}`;

export class WorktreeLeases {
  private readonly holders = new Map<string, Holder[]>();
  private readonly queue: Waiter[] = [];

  private compatible(key: string, owner: string, mode: LeaseMode): boolean {
    for (const h of this.holders.get(key) ?? []) {
      if (h.owner === owner && (h.mode === mode || (mode === 'exclusive' && h.mode === 'shared'))) continue;
      if (mode === 'exclusive' || h.mode === 'exclusive') return false;
      if (h.mode !== mode) return false;
    }
    return true;
  }

  private grantable(w: Pick<Waiter, 'owner' | 'mode' | 'keys'>, ahead: readonly Waiter[]): boolean {
    for (const key of w.keys) {
      if (!this.compatible(key, w.owner, w.mode)) return false;
      // FIFO per key: an earlier incompatible request on the same key goes first.
      if (ahead.some((a) => a.keys.includes(key) && a.owner !== w.owner && (a.mode !== w.mode || a.mode === 'exclusive'))) return false;
    }
    return true;
  }

  private take(owner: string, mode: LeaseMode, keys: readonly string[]): void {
    for (const key of keys) {
      const list = this.holders.get(key) ?? [];
      list.push({ owner, mode });
      this.holders.set(key, list);
    }
  }

  /** Acquire `mode` on every key at once (all or none). Resolves with the release. */
  acquire(keys: readonly string[], mode: LeaseMode, owner: string): Promise<() => void> {
    const unique = [...new Set(keys)];
    const release = () => this.release(owner, mode, unique);
    if (unique.length === 0) return Promise.resolve(() => undefined);
    if (this.grantable({ owner, mode, keys: unique }, this.queue)) {
      this.take(owner, mode, unique);
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      this.queue.push({ owner, mode, keys: unique, grant: () => resolve(release) });
    });
  }

  /** Release one owner's leases of one mode (on the given keys, or everywhere). */
  release(owner: string, mode?: LeaseMode, keys?: readonly string[]): void {
    for (const [key, list] of this.holders) {
      if (keys && !keys.includes(key)) continue;
      const kept = list.filter((h) => !(h.owner === owner && (mode === undefined || h.mode === mode)));
      if (kept.length === 0) this.holders.delete(key);
      else this.holders.set(key, kept);
    }
    this.pump();
  }

  /** Whether any shared (map) lease is held on one of the keys. */
  heldShared(keys: readonly string[]): boolean {
    return keys.some((k) => (this.holders.get(k) ?? []).some((h) => h.mode === 'shared'));
  }

  private pump(): void {
    for (let i = 0; i < this.queue.length; ) {
      const w = this.queue[i]!;
      if (this.grantable(w, this.queue.slice(0, i))) {
        this.queue.splice(i, 1);
        this.take(w.owner, w.mode, w.keys);
        w.grant();
        continue;
      }
      i += 1;
    }
  }

  /** Held and waiting leases per key (health, P07). */
  snapshot(): Array<{ key: string; holders: Holder[]; waiting: number }> {
    const keys = new Set([...this.holders.keys(), ...this.queue.flatMap((w) => w.keys)]);
    return [...keys].sort().map((key) => ({
      key,
      holders: [...(this.holders.get(key) ?? [])],
      waiting: this.queue.filter((w) => w.keys.includes(key)).length,
    }));
  }
}
