// ────────────────────────────────────────────────────────────────
// P2-00 — seeded, deterministic data for the sandbox (scripts/redesign/
// sandbox.mjs) and, later, VRT's Playwright `globalSetup` (09-verification.md
// §4.2). Reuses the same seeders `agent-tests/helpers/api.ts` already gives
// the e2e suite, so sandbox/VRT data stays consistent with what e2e expects.
//
// Idempotent on a re-run against the SAME (already-seeded) DB: every entity
// is looked up by its fixed name first, and only created if missing. It is
// NOT idempotent across a fresh DB vs. a reused one in the sense of avoiding
// near-duplicate names — it is idempotent in the sense that matters here:
// running it twice against one DB never creates a second copy of anything.
//
// Usage:
//   node_modules/.bin/tsx agent-tests/vrt/seed.ts
//   API_URL=http://localhost:3197/api node_modules/.bin/tsx agent-tests/vrt/seed.ts
//
// Also usable as a Playwright `globalSetup` (the default export matches
// Playwright's `(config: FullConfig) => unknown` shape — the argument is
// simply unused here since every server URL already comes from env, exactly
// like `agent-tests/helpers/api.ts` itself).
// ────────────────────────────────────────────────────────────────

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ResourceTracker,
  seedChat,
  seedProject,
  seedAgent,
  seedWorkflowDefinition,
  seedAutomation,
  findChatIdByName,
  findProjectIdByName,
  findAgentIdByName,
  findWorkflowDefinitionIdByName,
  findAutomationIdByName,
  archiveChat,
  sendChatPrompt,
  waitForPendingInteraction,
} from '../helpers/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = join(__dirname, '.seed.json');

// Fixed names — also the keys `agent-tests/vrt/fixtures/sandbox.faux.json`
// scripts responses for, under GENERATORAI_TEST_FAUX_SCRIPT.
const PROJECT_NAME = 'Sandbox Project';
const ACTIVE_CHAT_NAME = 'Sandbox — Active Chat';
const ARCHIVED_CHAT_NAME = 'Sandbox — Archived Chat';
const NEEDS_YOU_CHAT_NAME = 'Sandbox — Needs Your Review';
const AGENT_NAME = 'Sandbox Reviewer';
const WORKFLOW_NAME = 'Sandbox Workflow';
const AUTOMATION_NAME = 'Sandbox Automation';

export interface SandboxSeedResult {
  projectId: string;
  activeChatId: string;
  archivedChatId: string;
  /**
   * Present whenever the chat exists; only actually "needs you" (has a
   * pending interaction) when `needsYouSupported` is true — see that field's
   * doc comment.
   */
  needsYouChatId: string;
  /**
   * True once a pending interaction was observed on `needsYouChatId`. False
   * means the chat exists but has no pending gate — most likely because the
   * server wasn't started with GENERATORAI_TEST_FAUX_SCRIPT pointed at
   * `fixtures/sandbox.faux.json` (a plain GENERATORAI_TEST_FAUX_HARNESS run,
   * or a real-provider run, has nothing to drive the gate — the Faux script
   * hook is what makes this state reachable deterministically; see
   * FauxPermissionRequestEntry in FauxProvider.ts). A caller that needs the
   * pending state to exist should treat `false` as "not available today" and
   * note it, per P2-00's "else note it" instruction, rather than fail.
   */
  needsYouSupported: boolean;
  agentId: string;
  workflowDefinitionId: string;
  automationId: string;
}

async function findOrSeedProject(tracker: ResourceTracker): Promise<string> {
  return (
    (await findProjectIdByName(PROJECT_NAME)) ??
    (await seedProject(tracker, { name: PROJECT_NAME, description: 'Fixed-name project for the P2-00 sandbox / VRT.' }))
  );
}

async function findOrSeedChat(
  tracker: ResourceTracker,
  name: string,
  opts: { permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' } = {},
): Promise<string> {
  return (
    (await findChatIdByName(name)) ??
    (await seedChat(tracker, { name, tags: ['e2e-seed', 'sandbox'], ...opts }))
  );
}

async function findOrSeedAgent(tracker: ResourceTracker): Promise<string> {
  const existing = await findAgentIdByName(AGENT_NAME);
  if (existing) return existing;
  return seedAgent(tracker, {
    name: AGENT_NAME,
    description: 'Fixed-name reusable agent seeded for the P2-00 sandbox / VRT routes.',
    instructions: 'You review proposed changes and summarise risk before approving them.',
    tags: ['e2e-seed', 'sandbox'],
  });
}

async function findOrSeedWorkflow(tracker: ResourceTracker): Promise<string> {
  const existing = await findWorkflowDefinitionIdByName(WORKFLOW_NAME);
  if (existing) return existing;
  return seedWorkflowDefinition(tracker, {
    name: WORKFLOW_NAME,
    description: 'Fixed-name workflow definition for the P2-00 sandbox / VRT.',
    stages: [
      { localId: 'plan', name: 'Plan', prompt: 'Draft a short plan.' },
      { localId: 'apply', name: 'Apply', prompt: 'Apply the plan.' },
    ],
    edges: [{ from: 'plan', to: 'apply', type: 'on_success' }],
    tags: ['e2e-seed', 'sandbox'],
  });
}

async function findOrSeedAutomation(tracker: ResourceTracker, workflowDefinitionId: string): Promise<string> {
  return (
    (await findAutomationIdByName(AUTOMATION_NAME)) ??
    (await seedAutomation(tracker, { name: AUTOMATION_NAME, workflowIds: [workflowDefinitionId], triggerType: 'manual' }))
  );
}

/**
 * The needs-you chat only becomes genuinely pending once a turn has actually
 * run the scripted `permission_request` entry from
 * `fixtures/sandbox.faux.json`. Idempotent: if it is already pending (a
 * prior run got this far), nothing is resent.
 */
async function findOrSeedNeedsYouChat(tracker: ResourceTracker): Promise<{ chatId: string; supported: boolean }> {
  // 'default' (not the server's 'bypassPermissions' default): a bypass chat
  // auto-grants every permission_request instantly — see
  // decideToolPermission / shouldAttachPermissionHandler — so no gate would
  // ever open regardless of the Faux script.
  const chatId = await findOrSeedChat(tracker, NEEDS_YOU_CHAT_NAME, { permissionMode: 'default' });

  const alreadyPending = await waitForPendingInteraction(chatId, 500);
  if (alreadyPending.length > 0) return { chatId, supported: true };

  // Not pending yet — send the prompt the fixture script keys off of, then
  // wait briefly for the gate to open. On a server without the fixture
  // loaded (no GENERATORAI_TEST_FAUX_SCRIPT, or a different Faux script,
  // or a real provider) this simply times out with an empty result, which
  // is the documented "not supported today" outcome.
  try {
    await sendChatPrompt(chatId, 'Please make the change we discussed.');
  } catch {
    // CHAT_BUSY / INTERACTION_PENDING / network hiccup — fall through to the
    // poll below, which will report accurately either way.
  }
  const pending = await waitForPendingInteraction(chatId, 10_000);
  return { chatId, supported: pending.length > 0 };
}

export default async function seed(): Promise<SandboxSeedResult> {
  const tracker = new ResourceTracker(); // seeding is idempotent by design; kept for API symmetry, not used to clean up

  const projectId = await findOrSeedProject(tracker);
  const activeChatId = await findOrSeedChat(tracker, ACTIVE_CHAT_NAME);

  const archivedChatId = await findOrSeedChat(tracker, ARCHIVED_CHAT_NAME);
  // seedChat doesn't set status — archive it if this run just created it (or
  // a prior run left it active for some reason).
  try {
    await archiveChat(archivedChatId);
  } catch {
    // Already archived, or archiving isn't reachable — non-fatal for seeding.
  }

  const { chatId: needsYouChatId, supported: needsYouSupported } = await findOrSeedNeedsYouChat(tracker);

  const agentId = await findOrSeedAgent(tracker);
  const workflowDefinitionId = await findOrSeedWorkflow(tracker);
  const automationId = await findOrSeedAutomation(tracker, workflowDefinitionId);

  return {
    projectId,
    activeChatId,
    archivedChatId,
    needsYouChatId,
    needsYouSupported,
    agentId,
    workflowDefinitionId,
    automationId,
  };
}

async function main(): Promise<void> {
  const result = await seed();
  await writeFile(SEED_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`[seed] wrote ${SEED_FILE}`);
  console.log(`[seed] project=${result.projectId}`);
  console.log(`[seed] activeChat=${result.activeChatId}`);
  console.log(`[seed] archivedChat=${result.archivedChatId}`);
  console.log(
    `[seed] needsYouChat=${result.needsYouChatId} (pending=${result.needsYouSupported}` +
      `${result.needsYouSupported ? '' : ' — GENERATORAI_TEST_FAUX_SCRIPT not pointed at fixtures/sandbox.faux.json?'})`,
  );
  console.log(`[seed] agent=${result.agentId}`);
  console.log(`[seed] workflowDefinition=${result.workflowDefinitionId}`);
  console.log(`[seed] automation=${result.automationId}`);
}

// Runnable directly (`tsx agent-tests/vrt/seed.ts`) as well as importable as
// a Playwright `globalSetup` default export.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  });
}
