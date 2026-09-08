// ────────────────────────────────────────────────────────────────
// Sources model — the mount plan a new chat is created with.
//
// A port of `apps/web/src/components/chat/sources/sourceModel.ts`, restricted
// to what a phone can supply: project codebases. A `folder` source is a path
// on the machine running GeneratorAI, which this device cannot browse, so it
// is representable (for editing an existing plan) but never authored here.
//
// Output is `CreateChatSchema.sources` verbatim (`packages/shared`).
// ────────────────────────────────────────────────────────────────

export type SourceMode = 'in-place' | 'worktree';
export type BranchMode = 'current' | 'existing' | 'new';

export interface DraftSource {
  id: string;
  kind: 'codebase' | 'folder';
  codebaseId?: string;
  path?: string;
  /** Display name of the codebase / folder. */
  name: string;
  alias: string;
  mode: SourceMode;
  branchMode: BranchMode;
  branch: string;
  newBranch: string;
  baseRef: string;
  defaultBranch?: string;
}

/** Wire shape — mirrors `ChatSourceSpecSchema`. */
export type ChatSourceSpec =
  | {
      kind: 'codebase';
      codebaseId: string;
      mode: SourceMode;
      alias: string;
      branch?: string;
      newBranch?: string;
      baseRef?: string;
    }
  | {
      kind: 'folder';
      path: string;
      mode: SourceMode;
      alias: string;
      branch?: string;
      newBranch?: string;
      baseRef?: string;
    };

export function slugifyChatName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  );
}

export function defaultNewBranch(chatName: string): string {
  return `generatorai/${slugifyChatName(chatName)}`;
}

export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Server alias rule: letters, digits, `. _ -`, ≤ 64. */
export function sanitizeAlias(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'source';
}

export function uniqueAlias(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** The branch the mount will end up on, or null for "whatever it is on now". */
export function effectiveBranch(draft: DraftSource, chatName: string): string | null {
  if (draft.branchMode === 'new') return draft.newBranch.trim() || defaultNewBranch(chatName);
  if (draft.branchMode === 'existing') return draft.branch.trim() || null;
  return null;
}

export function draftsToSources(drafts: readonly DraftSource[], chatName: string): ChatSourceSpec[] {
  return drafts.map((d) => {
    const common: {
      mode: SourceMode;
      alias: string;
      branch?: string;
      newBranch?: string;
      baseRef?: string;
    } = { mode: d.mode, alias: d.alias };
    if (d.branchMode === 'new') {
      common.newBranch = d.newBranch.trim() || defaultNewBranch(chatName);
      const base = d.baseRef.trim();
      if (base) common.baseRef = base;
    } else if (d.branchMode === 'existing' && d.branch.trim()) {
      common.branch = d.branch.trim();
    }
    return d.kind === 'codebase'
      ? { kind: 'codebase', codebaseId: d.codebaseId ?? '', ...common }
      : { kind: 'folder', path: d.path ?? '', ...common };
  });
}

/** `frontend → worktree on generatorai/cart-fix from main` */
export function describeDraft(draft: DraftSource, chatName: string): string {
  const mode = draft.mode === 'worktree' ? 'worktree' : 'in place';
  const branch = effectiveBranch(draft, chatName);
  if (!branch) return `${draft.alias} → ${mode}`;
  const base =
    draft.branchMode === 'new' && draft.baseRef.trim() ? ` from ${draft.baseRef.trim()}` : '';
  return `${draft.alias} → ${mode} on ${branch}${base}`;
}

export function sourcesSummary(drafts: readonly DraftSource[]): string {
  if (drafts.length === 0) return 'None';
  if (drafts.length === 1) return drafts[0]!.alias;
  return `${drafts.length} sources`;
}

const BRANCH_RE = /^[^\s~^:?*[\]\\]+$/;

/** First problem with the plan, or null. Mirrors the server's schema rules. */
export function validateDrafts(drafts: readonly DraftSource[]): string | null {
  if (drafts.length > 8) return 'Up to 8 sources per chat.';
  const aliases = new Set<string>();
  for (const d of drafts) {
    if (!d.alias) return 'Every source needs an alias.';
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(d.alias)) {
      return `Alias “${d.alias}” may only contain letters, digits, . _ -`;
    }
    if (aliases.has(d.alias)) return `Two sources share the alias “${d.alias}”.`;
    aliases.add(d.alias);
    if (d.kind === 'codebase' && !d.codebaseId) return 'A codebase source is missing its codebase.';
    if (d.branchMode === 'existing' && d.branch.trim() && !BRANCH_RE.test(d.branch.trim())) {
      return `“${d.branch}” is not a valid branch name.`;
    }
    if (d.branchMode === 'new') {
      const nb = d.newBranch.trim();
      if (nb && !BRANCH_RE.test(nb)) return `“${nb}” is not a valid branch name.`;
      const base = d.baseRef.trim();
      if (base && !BRANCH_RE.test(base)) return `“${base}” is not a valid base ref.`;
    }
    if (d.branchMode === 'new' && d.mode === 'in-place') {
      // Allowed by the server (it checks out the branch in place), but worth
      // a plain-language warning; not a validation failure.
    }
  }
  return null;
}

export interface CodebaseLike {
  id: string;
  alias: string;
  defaultBranch?: string;
}

export function draftFromCodebase(
  codebase: CodebaseLike,
  takenAliases: Iterable<string>,
): DraftSource {
  const alias = uniqueAlias(sanitizeAlias(codebase.alias), takenAliases);
  return {
    id: `cb:${codebase.id}:${Date.now()}`,
    kind: 'codebase',
    codebaseId: codebase.id,
    name: codebase.alias,
    alias,
    mode: 'worktree',
    branchMode: 'current',
    branch: '',
    newBranch: '',
    baseRef: '',
    ...(codebase.defaultBranch ? { defaultBranch: codebase.defaultBranch } : {}),
  };
}

/** The primary mount: an explicit alias if it is still in the plan, else the first. */
export function resolvePrimary(
  drafts: readonly DraftSource[],
  primaryAlias: string | undefined,
): string | undefined {
  if (drafts.length === 0) return undefined;
  if (primaryAlias && drafts.some((d) => d.alias === primaryAlias)) return primaryAlias;
  return undefined;
}
