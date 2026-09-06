// ────────────────────────────────────────────────────────────────
// Review 6.1 — two prompts at once.
//
// `sendPrompt` swapped the turn's event listener without aborting the turn it
// detached, so a second prompt left the first query running with nowhere to
// send its output: the whole first response was produced, paid for, and lost.
// The web client disabled Send while streaming, but the API, the terminal and
// the SDK did not, so the refusal has to be server-side.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';
import { createTestApp } from '../helpers/testApp.js';

describe('POST /chats/:id/prompt while a turn is running', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('refuses with 409 CHAT_BUSY and never dispatches the prompt', async () => {
    (container.chatManagementService.isTurnActive as unknown as { mockReturnValue: (v: boolean) => void })
      .mockReturnValue(true);

    const res = await request(app).post('/api/chats/chat-1/prompt').send({ prompt: 'second' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHAT_BUSY');
    // The point of the guard: the first turn is left alone.
    expect(container.chatManagementService.sendPrompt).not.toHaveBeenCalled();
  });

  it('accepts the prompt once the turn has finished', async () => {
    (container.chatManagementService.isTurnActive as unknown as { mockReturnValue: (v: boolean) => void })
      .mockReturnValue(false);

    const res = await request(app).post('/api/chats/chat-1/prompt').send({ prompt: 'first' });

    expect(res.status).toBe(202);
    expect(container.chatManagementService.sendPrompt).toHaveBeenCalled();
  });
});
