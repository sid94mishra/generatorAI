// ────────────────────────────────────────────────────────────────
// Palette entity search — GET /api/search (G-18, 05-gap-matrix.md §G-18).
//
// One merged, ranked list across chats, projects, agents, workflow
// definitions, automations and workflow scripts. Every source is an
// EXISTING read-only repository/service call already exposed on
// `Container` — no new engine SQL, no migration, same pattern G-10/G-11/
// G-13/G-15 used. `workflowDefinitionService` / `automationService` /
// `workflowScriptLoader` are Workflow-Overhaul-owned engine code
// (07-phases.md §"Running in parallel"): only their existing read methods
// are called, and matching/ranking happens here, in memory.
//
// "The results respect each type's read scope" (05 §G-18): `types` is
// filtered down to what the calling principal can read BEFORE any query
// runs, using the same `req.principal.scopes` check `attention.ts` uses for
// its own redaction (`null` = unauthenticated loopback dev mode = full
// access).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type {
  Agent,
  Automation,
  Project,
  SearchEntityType,
  SearchResult,
  SearchResultAction,
  WorkflowDefinition,
} from '@generatorai/shared';
import { SEARCH_ENTITY_TYPES } from '@generatorai/shared';
import { STATUS_MAPS } from '@generatorai/shared';
import type { Scope } from '@generatorai/auth';
import type { Container } from '../composition-root.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** How many candidates each type may contribute before the final global rank + trim. */
const PER_TYPE_CANDIDATE_LIMIT = 25;

/** Which read scope gates seeing a given type's results at all. */
const SCOPE_FOR_TYPE: Record<SearchEntityType, Scope> = {
  chat: 'read:chats',
  project: 'read:projects',
  agent: 'read:workflows',
  workflow: 'read:workflows',
  automation: 'read:workflows',
  script: 'read:workflows',
};

interface Candidate {
  result: Omit<SearchResult, 'status'> & { status?: SearchResult['status'] };
  /** Text score from title/description/tag matching (prefix beats substring). */
  textScore: number;
  updatedAtMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prefix match beats substring match beats "only matched on description/tags". */
function titleMatchScore(q: string, title: string): number {
  const t = title.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 100;
  return 0;
}

/** Recency contributes up to 50 points, decaying linearly to 0 over 30 days. */
function recencyScore(updatedAtMs: number, now: number): number {
  const ageDays = Math.max(0, (now - updatedAtMs) / DAY_MS);
  return Math.max(0, 50 - ageDays * (50 / 30));
}

/** `undefined` when `q` matches nowhere (title, description, or a tag). */
function matchScore(q: string, title: string, extra: Array<string | undefined>): number | undefined {
  const titleScore = titleMatchScore(q, title);
  if (titleScore > 0) return titleScore;
  const lowerQ = q;
  for (const field of extra) {
    if (field && field.toLowerCase().includes(lowerQ)) return 50;
  }
  return undefined;
}

export function createSearchRoutes(container: Container): Router {
  const router = Router();
  const {
    chatEntityRepo,
    projectService,
    agentRepo,
    workflowDefinitionService,
    automationService,
    workflowScriptLoader,
    attentionService,
  } = container;

  router.get('/', async (req, res, next) => {
    try {
      const q = String(req.query['q'] ?? '').trim();
      if (!q) {
        res.json({ results: [] });
        return;
      }
      const lowerQ = q.toLowerCase();

      const limitParam = Number(req.query['limit']);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT;

      const typesRaw = req.query['types'];
      const requestedTypes = typeof typesRaw === 'string' && typesRaw.length > 0
        ? (typesRaw.split(',').map((t) => t.trim()).filter((t): t is SearchEntityType => (SEARCH_ENTITY_TYPES as readonly string[]).includes(t)))
        : [...SEARCH_ENTITY_TYPES];

      // Respect each type's read scope (null principal = unauthenticated
      // loopback dev mode = full access, same convention as attention.ts).
      const scopes = req.principal ? req.principal.scopes : null;
      const canRead = (type: SearchEntityType): boolean => scopes === null || scopes.includes(SCOPE_FOR_TYPE[type]);
      const types = requestedTypes.filter(canRead);

      const now = Date.now();
      const candidates: Candidate[] = [];

      if (types.includes('chat')) {
        const page = await chatEntityRepo.listPage({ filter: { q }, sort: 'activity', limit: PER_TYPE_CANDIDATE_LIMIT });
        for (const row of page.rows) {
          const score = matchScore(lowerQ, row.chat.name || 'Untitled chat', [row.chat.description, ...(row.chat.tags ?? [])]);
          if (score === undefined) continue;
          const turnMapping = row.activity.lastTurn ? STATUS_MAPS.chatTurn[row.activity.lastTurn.status] : null;
          candidates.push({
            textScore: score,
            updatedAtMs: row.activity.lastActivityAt.getTime(),
            result: {
              type: 'chat',
              id: row.chat.id,
              title: row.chat.name || 'Untitled chat',
              ...(row.activity.changes ? { subtitle: `${row.activity.changes.additions} additions, ${row.activity.changes.deletions} deletions` } : {}),
              href: `/chats/${row.chat.id}`,
              ...(turnMapping ? { status: turnMapping.state } : {}),
              actions: ['open'] as SearchResultAction[],
            },
          });
        }
      }

      if (types.includes('project')) {
        const projects: Project[] = await projectService.listProjects({ status: 'active' });
        for (const project of projects) {
          const score = matchScore(lowerQ, project.name, [project.description]);
          if (score === undefined) continue;
          candidates.push({
            textScore: score,
            updatedAtMs: project.updatedAt.getTime(),
            result: {
              type: 'project',
              id: project.id,
              title: project.name,
              ...(project.description ? { subtitle: project.description } : {}),
              href: `/projects/${project.id}`,
              actions: ['open'],
            },
          });
        }
      }

      if (types.includes('agent')) {
        const agents: Agent[] = await agentRepo.list({ query: q, enabledOnly: true });
        for (const agent of agents.slice(0, PER_TYPE_CANDIDATE_LIMIT)) {
          candidates.push({
            textScore: titleMatchScore(lowerQ, agent.name) || 50,
            updatedAtMs: 0,
            result: {
              type: 'agent',
              id: agent.id,
              title: agent.name,
              subtitle: agent.role,
              href: `/agents/${agent.id}`,
              actions: ['open'],
            },
          });
        }
      }

      if (types.includes('workflow')) {
        const definitions: WorkflowDefinition[] = await workflowDefinitionService.listDefinitions();
        for (const def of definitions) {
          const score = matchScore(lowerQ, def.name, [def.description, ...(def.tags ?? [])]);
          if (score === undefined) continue;
          candidates.push({
            textScore: score,
            updatedAtMs: 0,
            result: {
              type: 'workflow',
              id: def.id,
              title: def.name,
              ...(def.description ? { subtitle: def.description } : {}),
              href: `/workflows/${def.id}`,
              actions: ['open', 'run'],
            },
          });
        }
      }

      if (types.includes('automation')) {
        const automations: Automation[] = await automationService.listAutomations();
        for (const automation of automations) {
          const score = matchScore(lowerQ, automation.name, [automation.description]);
          if (score === undefined) continue;
          candidates.push({
            textScore: score,
            updatedAtMs: 0,
            result: {
              type: 'automation',
              id: automation.id,
              title: automation.name,
              ...(automation.description ? { subtitle: automation.description } : {}),
              href: `/automations/${automation.id}`,
              actions: ['open'],
            },
          });
        }
      }

      if (types.includes('script')) {
        // Scripts are opt-in (`scripts.workflowScriptsEnabled`); when they are
        // disabled `getAllMetadata` throws `ScriptSecurityError` — treated as
        // "no scripts to search", not a search-wide failure.
        try {
          const scripts = workflowScriptLoader.getAllMetadata();
          for (const script of scripts) {
            const score = matchScore(lowerQ, script.name, [script.description, ...(script.tags ?? [])]);
            if (score === undefined) continue;
            candidates.push({
              textScore: score,
              updatedAtMs: script.lastModified.getTime(),
              result: {
                type: 'script',
                id: script.id,
                title: script.name,
                ...(script.description ? { subtitle: script.description } : {}),
                href: `/scripts/${script.id}`,
                actions: ['open'],
              },
            });
          }
        } catch {
          // disabled — no scripts to contribute
        }
      }

      candidates.sort((a, b) => (b.textScore + recencyScore(b.updatedAtMs, now)) - (a.textScore + recencyScore(a.updatedAtMs, now)));
      const results: SearchResult[] = candidates.slice(0, limit).map((c) => c.result as SearchResult);

      // G-01 — a live chat's state (needs_you/running) outranks its finished-turn mapping.
      if (attentionService.isAvailable()) {
        const snapshot = attentionService.getSnapshot();
        const live = new Map<string, SearchResult['status']>();
        for (const item of snapshot.needsYou) if (item.entity === 'chat') live.set(item.entityId, 'needs_you');
        for (const item of snapshot.running) if (item.entity === 'chat' && !live.has(item.entityId)) live.set(item.entityId, 'running');
        for (const result of results) {
          if (result.type === 'chat' && live.has(result.id)) result.status = live.get(result.id);
        }
      }

      res.set('Cache-Control', 'no-store').json({ results });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
