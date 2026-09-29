export interface CodebaseStatusLike {
  id: string;
  alias: string;
  status?: string | null;
  lastError?: string | null;
}

export function isCloningStatus(status: string | null | undefined): boolean {
  return status === 'cloning' || status === 'pending';
}

/** Poll while any codebase is still cloning. */
export function anyCloning(codebases: readonly CodebaseStatusLike[] | undefined): boolean {
  return (codebases ?? []).some((c) => isCloningStatus(c.status));
}

