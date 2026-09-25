// ────────────────────────────────────────────────────────────────
// Security layer (R-8; P01 design decision 5, W-34):
// - commands and arguments are literals: a template there would let a
//   variable value become shell syntax (Windows `cmd /c` escaping cannot
//   be made safe); templated values reach commands only through env;
// - secrets are `secretref:` references, never literals.
// ────────────────────────────────────────────────────────────────

import { collectCommandFields } from '../commandBearing.js';
import type { WorkflowGraph } from '../schemas/graph.js';
import type { SessionSpec } from '../schemas/session.js';
import { pointerToken, type ValidationIssue } from './issues.js';

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i,
  /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/i,
];

const SECRET_ENV_NAME = /(token|secret|passw(or)?d|api[_-]?key|private[_-]?key|credential)/i;
const SECRET_HEADER_NAME = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie)$/i;

const isSecretRef = (v: string) => v.startsWith('secretref:');
const isTemplated = (v: string) => v.includes('{{');

/** Why a key/value pair looks like a literal secret, or null. */
export function literalSecretReason(name: string, value: string, kind: 'env' | 'header'): string | null {
  if (!value || isSecretRef(value)) return null;
  if (SECRET_VALUE_PATTERNS.some((re) => re.test(value))) return 'the value looks like a credential';
  if (isTemplated(value)) return null;
  const nameLooksSecret = kind === 'header' ? SECRET_HEADER_NAME.test(name) : SECRET_ENV_NAME.test(name);
  return nameLooksSecret ? `'${name}' names a secret` : null;
}

function checkPairs(
  pairs: Readonly<Record<string, string>> | undefined,
  kind: 'env' | 'header',
  pointer: string,
  stageKey: string | undefined,
  out: ValidationIssue[],
): void {
  if (!pairs) return;
  for (const [name, value] of Object.entries(pairs)) {
    const reason = literalSecretReason(name, value, kind);
    if (!reason) continue;
    out.push({
      code: 'secret-literal',
      severity: 'error',
      path: `${pointer}/${pointerToken(name)}`,
      ...(stageKey ? { stageKey } : {}),
      message: `Literal secret in ${kind === 'env' ? 'an environment variable' : 'a header'}: ${reason}`,
      hint: 'Store it in the secret store and reference it as secretref:<name>',
    });
  }
}

function checkSession(session: SessionSpec | undefined, pointer: string, stageKey: string | undefined, out: ValidationIssue[]): void {
  if (!session) return;
  const key = session.provider?.apiKey;
  if (key !== undefined && !isSecretRef(key)) {
    out.push({
      code: 'secret-not-secretref',
      severity: 'error',
      path: `${pointer}/provider/apiKey`,
      ...(stageKey ? { stageKey } : {}),
      message: 'provider.apiKey must be a secretref: reference',
      hint: 'Store the key in the secret store and reference it as secretref:<name>',
    });
  }
  for (const [id, cfg] of Object.entries(session.mcp?.servers ?? {})) {
    const base = `${pointer}/mcp/servers/${pointerToken(id)}`;
    checkPairs(cfg.headers, 'header', `${base}/headers`, stageKey, out);
    checkPairs(cfg.env, 'env', `${base}/env`, stageKey, out);
  }
}

export function securityIssues(graph: WorkflowGraph): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  for (const f of collectCommandFields(graph)) {
    const stage = f.stageKey ? { stageKey: f.stageKey } : {};
    const isScript = f.kind === 'preprocessing' || f.kind === 'postprocessing';
    if (f.command !== undefined && isTemplated(f.command)) {
      out.push({
        code: 'template-in-command',
        severity: 'error',
        path: `${f.pointer}/${isScript ? 'script' : 'command'}`,
        ...stage,
        message: isScript ? 'A script cannot contain templates' : 'A command cannot contain templates',
        hint: isScript
          ? 'Variables reach scripts as GEN_VAR_<name> environment variables'
          : 'Pass values through env (for example env: {"ISSUE": "{{variables.issue}}"}) and read them in the program',
      });
    }
    f.args?.forEach((a, i) => {
      if (!isTemplated(a)) return;
      out.push({
        code: 'template-in-command',
        severity: 'error',
        path: `${f.pointer}/args/${i}`,
        ...stage,
        message: 'Command arguments cannot contain templates',
        hint: 'Pass values through env and read them in the program',
      });
    });
    if (f.kind !== 'mcp') checkPairs(f.env, 'env', `${f.pointer}/env`, f.stageKey, out);
  }

  const httpHooks = (list: ReadonlyArray<{ config: { type: string; headers?: Record<string, string> } }> | undefined, pointer: string, stageKey?: string) =>
    list?.forEach((h, i) => {
      if (h.config.type === 'http') checkPairs(h.config.headers, 'header', `${pointer}/${i}/config/headers`, stageKey, out);
    });
  httpHooks(graph.workflow.hooks, '/workflow/hooks');
  httpHooks(graph.workflow.onExit, '/workflow/onExit');
  httpHooks(graph.workflow.onFailure, '/workflow/onFailure');
  checkSession(graph.workflow.session, '/workflow/session', undefined, out);
  graph.stages.forEach((s, i) => {
    httpHooks(s.hooks, `/stages/${i}/hooks`, s.key);
    httpHooks(
      s.compensate as ReadonlyArray<{ config: { type: string; headers?: Record<string, string> } }> | undefined,
      `/stages/${i}/compensate`,
      s.key,
    );
    checkSession(s.session, `/stages/${i}/session`, s.key, out);
  });
  return out;
}
