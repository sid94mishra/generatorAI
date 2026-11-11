// ────────────────────────────────────────────────────────────────
// ACP agents in Settings › Model providers — pure helpers (docs/acp):
// search, the row's badges and status line, install progress text and
// splitting a typed argument line. React-free so the section and its tests
// share them.
// ────────────────────────────────────────────────────────────────

import type { AcpAgentInfo, AcpAgentsResponse, AcpAuthState, AcpDistributionKind, AcpInstallProgress } from '@generatorai/shared';

export type AcpBadgeTone = 'neutral' | 'run' | 'ok' | 'warn' | 'err';

export interface AcpBadge {
  label: string;
  tone: AcpBadgeTone;
  /** Longer text for the badge's tooltip. */
  title?: string;
}

/** Case-insensitive match on name, id, description and authors. */
export function filterAcpAgents(agents: readonly AcpAgentInfo[], query: string): AcpAgentInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...agents];
  return agents.filter((a) =>
    [a.name, a.id, a.description, ...(a.authors ?? [])].some((field) => field?.toLowerCase().includes(q)),
  );
}

/** The agent can be installed on this machine (a distribution was chosen). */
export const installable = (agent: AcpAgentInfo): boolean => !agent.custom && agent.distribution.selected !== null;

/** The agent can be turned on: installed, or a custom agent. */
export const enableable = (agent: AcpAgentInfo): boolean => agent.custom || agent.installed !== null;

/** Only an npm build exists and Node.js was not found. */
export function needsNode(agent: AcpAgentInfo, node: AcpAgentsResponse['node']): boolean {
  return !agent.custom && agent.distribution.selected === null && agent.distribution.offered.includes('npx') && !node.available;
}

/** The status of an enabled agent, as one short badge. */
export function runtimeBadge(agent: AcpAgentInfo): AcpBadge | null {
  const s = agent.enabled ? agent.status : undefined;
  if (!s) return null;
  if (s.ready) return { label: 'Ready', tone: 'ok' };
  if (s.authState === 'unauthenticated') return { label: 'Not signed in', tone: 'warn', ...(s.error ? { title: s.error } : {}) };
  if (s.error && s.error !== 'Starting…') return { label: 'Not working', tone: 'err', title: s.error };
  if (!s.connected || !s.checkedAt) return { label: 'Starting…', tone: 'neutral' };
  return { label: 'No models', tone: 'warn' };
}

/** Every badge of a row, in reading order. */
export function agentBadges(agent: AcpAgentInfo, node: AcpAgentsResponse['node']): AcpBadge[] {
  const badges: AcpBadge[] = [];
  if (agent.custom) badges.push({ label: 'Custom', tone: 'neutral' });
  if (agent.installing) badges.push({ label: 'Installing…', tone: 'run' });
  else if (agent.installed) badges.push({ label: `Installed v${agent.installed.version}`, tone: 'neutral' });
  if (agent.updateAvailable && !agent.installing) badges.push({ label: 'Update available', tone: 'run' });
  if (agent.installed?.unverified || (!agent.installed && installable(agent) && agent.distribution.unverified)) {
    badges.push({ label: 'Unverified download', tone: 'warn', title: 'The registry gives no checksum for this build, so the download cannot be verified.' });
  }
  const runtime = runtimeBadge(agent);
  if (runtime) badges.push(runtime);
  if (agent.nativeProvider) badges.push({ label: 'Also available as a native provider', tone: 'neutral' });
  if (needsNode(agent, node)) {
    badges.push({ label: 'Needs Node.js', tone: 'warn', ...(agent.distribution.unavailableReason ? { title: agent.distribution.unavailableReason } : {}) });
  } else if (!agent.custom && !agent.installed && agent.distribution.selected === null) {
    badges.push({ label: 'Not available on this platform', tone: 'neutral', ...(agent.distribution.unavailableReason ? { title: agent.distribution.unavailableReason } : {}) });
  }
  return badges;
}

const KIND_LABEL: Record<AcpDistributionKind, string> = {
  binary: 'Binary',
  npx: 'npm package',
  uvx: 'Python (uv)',
  custom: 'Custom command',
};

/** "Binary, npm package" with the one this machine uses first. */
export function distributionLabel(agent: AcpAgentInfo): string {
  const { offered, selected } = agent.distribution;
  const kinds = selected ? [selected, ...offered.filter((k) => k !== selected)] : offered;
  return kinds.map((k) => (k === selected && offered.length > 1 ? `${KIND_LABEL[k]} (used here)` : KIND_LABEL[k])).join(', ');
}

export const AUTH_STATE_LABEL: Record<AcpAuthState, string> = {
  authenticated: 'Signed in',
  unauthenticated: 'Not signed in',
  not_required: 'No sign-in needed',
  unknown: 'Unknown',
};

const PHASE_LABEL: Record<AcpInstallProgress['phase'], string> = {
  resolving: 'Preparing',
  downloading: 'Downloading',
  verifying: 'Verifying',
  extracting: 'Unpacking',
  npm: 'Installing with npm',
  finishing: 'Finishing',
};

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** "Downloading v1.2.0 · 3.1 of 12.0 MB". */
export function installProgressLabel(progress: AcpInstallProgress): string {
  const amount =
    progress.phase === 'downloading' && progress.receivedBytes > 0
      ? progress.totalBytes
        ? ` · ${mb(progress.receivedBytes)} of ${mb(progress.totalBytes)} MB`
        : ` · ${mb(progress.receivedBytes)} MB`
      : '';
  return `${PHASE_LABEL[progress.phase]} v${progress.version}${amount}`;
}

/**
 * Split a typed argument line the way a shell would for plain cases: spaces
 * separate arguments, single or double quotes keep spaces inside one, a
 * backslash escapes the next character outside single quotes.
 */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === '\\' && i + 1 < line.length) {
      current += line[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/** A valid environment variable name (the server's rule). */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
