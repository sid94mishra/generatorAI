// ────────────────────────────────────────────────────────────────
// WorktreeLeases — writer exclusion on the mounts a `mount_per_item` map
// forks from (P05 §4.1): the run mounts, or — for a map nested inside
// another map's item — that item's own mounts.
//
// One lease key per mount, `worktree:<mountId>`, three modes:
//   shared     a running mount_per_item map (its items work in their own
//              worktrees cut from a snapshot of this mount; nothing outside
//              the map may write the mount until the map settles)
//   write      a stage OUTSIDE such a map that may write the mount (every
//              agent and check launch placed on the mount); writers do not
//              exclude each other — parallel stages of one run always
//              shared their mounts
//   exclusive  a map's merge into the mount. It excludes writers and other
//              merges, but NOT another map's shared lease: a merge is a
//              3-way merge against the mount as it is now, so a mount that
//              moved under a sibling map's snapshot merges correctly (two
//              parallel maps would otherwise wait for each other forever)
//
//              shared   write   exclusive (other owner)
//   shared       ok      wait        wait
//   write       wait      ok         wait
//   exclusive    ok      wait        wait
//
// Requests are granted in FIFO order per key, so a waiting map snapshot is
// not starved by a stream of writers; a merge is not held back by the queue
// (the writers queued ahead of it wait for its map, which needs the merge to
// finish). A queued request can be withdrawn (its `signal`, or `release` of
// its owner): it leaves the queue and its acquire rejects. The leases are
// process-local like the engine lock; recovery re-takes the shared leases of
// the running maps.
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
  reject: (err: Error) => void;
}

export const worktreeLeaseKey = (mountId: string) => `worktree:${mountId}`;

/** A queued lease request that was withdrawn (its owner released, or its signal aborted). */
export class LeaseWithdrawnError extends Error {
  constructor(owner: string, mode: LeaseMode) {
    super(`The ${mode} worktree lease request of ${owner} was withdrawn`);
    this.name = 'AbortError';
  }
}

export class WorktreeLeases {
  private readonly holders = new Map<string, Holder[]>();
  private readonly queue: Waiter[] = [];

  private compatible(key: string, owner: string, mode: LeaseMode): boolean {
    for (const h of this.holders.get(key) ?? []) {
      if (h.owner === owner) continue; // an owner's own leases never conflict (a map's merge under its shared lease)
      if (mode === 'exclusive' ? h.mode !== 'shared' : h.mode !== mode) return false;
    }
    return true;
  }

  private grantable(w: Pick<Waiter, 'owner' | 'mode' | 'keys'>, ahead: readonly Waiter[]): boolean {
    for (const key of w.keys) {
      if (!this.compatible(key, w.owner, w.mode)) return false;
      // FIFO per key: an earlier incompatible request on the same key goes first (a merge does not wait in line).
      if (w.mode === 'exclusive') continue;
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

  /**
   * Acquire `mode` on every key at once (all or none). Resolves with the
   * release; rejects (`LeaseWithdrawnError`) when the request is withdrawn
   * while it waits.
   */
  acquire(keys: readonly string[], mode: LeaseMode, owner: string, signal?: AbortSignal): Promise<() => void> {
    const unique = [...new Set(keys)];
    const release = () => this.release(owner, mode, unique);
    if (unique.length === 0) return Promise.resolve(() => undefined);
    if (signal?.aborted) return Promise.reject(new LeaseWithdrawnError(owner, mode));
    if (this.grantable({ owner, mode, keys: unique }, this.queue)) {
      this.take(owner, mode, unique);
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => this.withdraw((w) => w === waiter);
      const waiter: Waiter = {
        owner,
        mode,
        keys: unique,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      this.queue.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Release one owner's leases of one mode (on the given keys, or
   * everywhere), and withdraw its queued requests of that mode.
   */
  release(owner: string, mode?: LeaseMode, keys?: readonly string[]): void {
    for (const [key, list] of this.holders) {
      if (keys && !keys.includes(key)) continue;
      const kept = list.filter((h) => !(h.owner === owner && (mode === undefined || h.mode === mode)));
      if (kept.length === 0) this.holders.delete(key);
      else this.holders.set(key, kept);
    }
    this.withdraw((w) => w.owner === owner && (mode === undefined || w.mode === mode) && (!keys || w.keys.some((k) => keys.includes(k))));
  }

  private withdraw(match: (w: Waiter) => boolean): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const w = this.queue[i]!;
      if (!match(w)) continue;
      this.queue.splice(i, 1);
      w.reject(new LeaseWithdrawnError(w.owner, w.mode));
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
