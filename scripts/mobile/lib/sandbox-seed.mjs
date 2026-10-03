import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from './sandbox-session.mjs';
import { assertDummyRepo } from './sandbox-data.mjs';

const execute = promisify(execFile);
export const CHAT_NAMES = Object.freeze({
  stream: 'Mobile — Stream', gate: 'Mobile — Gate', stop: 'Mobile — Stop',
  edits: 'Mobile — Edits', long: 'Mobile — Long stream',
});

async function waitForWorkspace(session, chat, key) {
  const deadline = Date.now() + 60000;
  let current = chat;
  while (['pending', 'preparing'].includes(current.workspacePrep?.status) && Date.now() < deadline) {
    await delay(250);
    current = await session.api(`/chats/${chat.id}`);
  }
  if (current.workspacePrep?.status !== 'ready') throw new Error(`Fixture ${key} workspace is not ready: ${current.workspacePrep?.error ?? current.workspacePrep?.status ?? 'unknown'}`);
}

export async function seedSandbox(session, fresh = []) {
  for (const key of fresh) if (!(key in CHAT_NAMES)) throw new Error(`Unknown fixture: ${key}`);
  const projects = await session.api('/projects');
  let project = projects.find(item => item.id === session.state.projectId);
  project ??= projects.find(item => item.name === 'Mobile sandbox repo');
  project ??= await session.api('/projects', { name: 'Mobile sandbox repo', description: 'Throwaway native verification fixture' });
  session.state.projectId = project.id;
  session.state.chats ??= {};
  session.state.fixtures ??= {};
  for (const [key, name] of Object.entries(CHAT_NAMES)) {
    const fixture = session.state.fixtures[key];
    let saved;
    if (fixture && session.state.chats[key]) {
      assertDummyRepo(fixture.repo);
      try { saved = await session.api(`/chats/${session.state.chats[key]}`); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    if (saved?.name === name && !fresh.includes(key)) { await waitForWorkspace(session, saved, key); continue; }
    // Retain old conversations/repos for diagnosis without exhausting the
    // project's real codebase limit during repeated fresh native flows.
    const codebases = await session.api(`/projects/${project.id}/codebases`);
    if (codebases.length >= (project.settings?.maxCodebases ?? 10)) {
      project = await session.api('/projects', { name: 'Mobile sandbox repo', description: 'Throwaway native verification fixture' });
      session.state.projectId = project.id;
      await session.save();
    }
    // Independent source directories prevent shared shadow-store registration and
    // one characterization flow's edits from leaking into another (MD-98).
    // 14 s measured on a loaded machine; 30 s killed it mid-commit under heavier load.
    const result = await execute(process.execPath, [path.join(ROOT, 'scripts/redesign/make-dummy-repo.mjs')], {
      cwd: ROOT, timeout: 120000,
    });
    const repo = assertDummyRepo(result.stdout.trim());
    const codebase = await session.api(`/projects/${project.id}/codebases`, {
      alias: `mobile-${key}-${randomUUID().slice(0, 8)}`, type: 'git-local', localPath: repo, defaultBranch: 'main',
    });
    const chat = await session.api('/chats', {
      name, projectId: project.id, model: 'faux-model', permissionMode: 'default',
      sources: [{ kind: 'codebase', codebaseId: codebase.id, mode: 'in-place', alias: 'dummy' }],
      primary: 'dummy', sourceControl: { autoCommit: false, autoPush: false, autoPullRequest: false },
    });
    session.state.fixtures[key] = { repo, codebaseId: codebase.id };
    session.state.chats[key] = chat.id;
    await session.save();
    await waitForWorkspace(session, chat, key);
  }
  session.state.dummyRepo = session.state.fixtures.edits.repo;
  await session.save();
  return session.state.chats;
}
