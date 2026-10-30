// A stack route's pathname from its file name and params ('workflows/[id]/runs/[runId]/index' + params →
// '/workflows/w1/runs/r1'), for header options that only receive `route`. Pure.
export function routePath(name: string, params: unknown): string {
  const values = (params ?? {}) as Record<string, unknown>;
  const parts = name
    .split('/')
    .filter((part) => part !== 'index' && !/^\(.*\)$/.test(part))
    .map((part) => {
      const match = /^\[(?:\.\.\.)?(.+)\]$/.exec(part);
      if (!match) return part;
      const value = values[match[1]!];
      return encodeURIComponent(typeof value === 'string' ? value : Array.isArray(value) ? value.join('/') : '');
    });
  return `/${parts.join('/')}`;
}
