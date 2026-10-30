// Which stream sequences a connection has applied, kept as ranges (U-39).
//
// The connection used to keep a Set of seen sequences pruned to 2000 below the tip, which made any hole older than
// that unrecoverable: a gap fill from further back would re-apply events it could no longer recognise, so it skipped
// them and showed "some events could not be recovered". Sequences are gap-free per scope and arrive almost in order,
// so the applied set is a handful of ranges however long a chat runs: nothing needs pruning, and a hole of any age
// can be refilled exactly. Only a pathological stream (more than MAX_RANGES separate holes) gives the oldest up.

const MAX_RANGES = 512;

export class SequenceLedger {
  /** Sorted, disjoint, non-adjacent `[from, to]` ranges of applied sequences. */
  private ranges: Array<[number, number]> = [];

  /** Highest sequence applied (0 when none). */
  get max(): number {
    return this.ranges.length > 0 ? this.ranges[this.ranges.length - 1]![1] : 0;
  }

  /** Highest `n` with every sequence 1..n applied: where a gap fill resumes. */
  get frontier(): number {
    const first = this.ranges[0];
    return first && first[0] <= 1 ? first[1] : 0;
  }

  /** Sequences missing below `max`. */
  get missing(): number {
    let applied = 0;
    for (const [from, to] of this.ranges) applied += to - from + 1;
    return this.max - applied;
  }

  has(seq: number): boolean {
    let lo = 0;
    let hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [from, to] = this.ranges[mid]!;
      if (seq < from) hi = mid - 1;
      else if (seq > to) lo = mid + 1;
      else return true;
    }
    return false;
  }

  /**
   * Marks `from..to` applied. Returns how many sequences were given up as unrecoverable to stay under MAX_RANGES
   * (0 in any stream that is not pathological).
   */
  addRange(from: number, to: number): number {
    if (to < from) return 0;
    // The live path: the next sequence in order extends the last range.
    const last = this.ranges[this.ranges.length - 1];
    if (last && from >= last[0] && from <= last[1] + 1) {
      last[1] = Math.max(last[1], to);
      return 0;
    }
    const next: Array<[number, number]> = [];
    let merged: [number, number] = [from, to];
    let placed = false;
    for (const range of this.ranges) {
      if (range[1] < merged[0] - 1) next.push(range);
      else if (range[0] > merged[1] + 1) {
        if (!placed) {
          next.push(merged);
          placed = true;
        }
        next.push(range);
      } else merged = [Math.min(range[0], merged[0]), Math.max(range[1], merged[1])];
    }
    if (!placed) next.push(merged);
    this.ranges = next;
    let lost = 0;
    while (this.ranges.length > MAX_RANGES) {
      const [a, b] = [this.ranges[0]!, this.ranges[1]!];
      lost += b[0] - a[1] - 1;
      this.ranges.splice(0, 2, [a[0], b[1]]);
    }
    return lost;
  }

  add(seq: number): number {
    return this.addRange(seq, seq);
  }

  clear(): void {
    this.ranges = [];
  }
}
