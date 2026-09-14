// ────────────────────────────────────────────────────────────────
// Source Control Routes — accounts, settings, device sign-in
//
// Contract: `.github/docs/feature-source-control.md` §2. Shared shapes:
// `packages/shared/src/types/SourceControl.ts`.
//
// Tokens are write-only across this surface: a token arrives in a POST body,
// goes straight to the config service (which hands it to the secret store)
// and never comes back out. Nothing here echoes `req.body.token`, and every
// message that could have been built from provider/CLI output — which does
// sometimes carry a remote URL with credentials in it — goes through
// `redactTokens` before it reaches a response or a log line.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { redactTokens } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import type { ActiveProvider } from '@generatorai/core';
import type {
  EditorId,
  ScmProviderId,
  SourceControlAuthMethod,
} from '@generatorai/shared';

const AUTH_METHODS: readonly SourceControlAuthMethod[] = ['token', 'gh-cli', 'device'];
const EDITOR_IDS: readonly EditorId[] = ['vscode', 'vscode-insiders', 'cursor', 'windsurf'];

/** The route-level 400. Service-thrown `ValidationError`s take the `next(err)` path instead. */
function badRequest(res: Response, message: string): void {
  res.status(400).json({
    error: { code: 'VALIDATION_ERROR', message: redactTokens(message) },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `string | null`, or `undefined` when the key is absent. Anything else is an error. */
function readNullableString(
  bag: Record<string, unknown>,
  key: string,
): { ok: true; value?: string | null } | { ok: false; message: string } {
  if (!(key in bag) || bag[key] === undefined) return { ok: true };
  const raw = bag[key];
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, message: `${key} must be a string or null` };
  return { ok: true, value: raw };
}

export function createSourceControlRoutes(container: Container): Router {
  const router = Router();
  const {
    sourceControlConfigService,
    sourceControlService,
    editorLauncherService,
    logger,
  } = container;

  // ════════════════════════════════════════════════════════════════
  // Settings (doc §2)
  // ════════════════════════════════════════════════════════════════

  // GET /source-control/settings — settings + what the server can sign in with
  // + which editors it can launch. One round trip for the Settings page.
  router.get('/settings', async (_req, res, next) => {
    try {
      const [providers, editors] = await Promise.all([
        sourceControlConfigService.providerInfo(),
        editorLauncherService.listEditors(),
      ]);
      res.json({ settings: sourceControlConfigService.getSettings(), providers, editors });
    } catch (err) {
      next(err);
    }
  });

  // PUT /source-control/settings — partial update; absent keys are untouched.
  router.put('/settings', async (req, res, next) => {
    try {
      const body: unknown = req.body ?? {};
      if (!isPlainObject(body)) {
        badRequest(res, 'Body must be an object');
        return;
      }

      const partial: Parameters<typeof sourceControlConfigService.updateSettings>[0] = {};

      const defaultAccountId = readNullableString(body, 'defaultAccountId');
      if (!defaultAccountId.ok) {
        badRequest(res, defaultAccountId.message);
        return;
      }
      if (defaultAccountId.value !== undefined) partial.defaultAccountId = defaultAccountId.value;

      if (body['generation'] !== undefined) {
        const generation = body['generation'];
        if (!isPlainObject(generation)) {
          badRequest(res, 'generation must be an object');
          return;
        }
        const provider = readNullableString(generation, 'provider');
        if (!provider.ok) {
          badRequest(res, `generation.${provider.message}`);
          return;
        }
        const model = readNullableString(generation, 'model');
        if (!model.ok) {
          badRequest(res, `generation.${model.message}`);
          return;
        }
        partial.generation = {
          ...(provider.value !== undefined ? { provider: provider.value } : {}),
          ...(model.value !== undefined ? { model: model.value } : {}),
        };
      }

      if (body['editor'] !== undefined) {
        const editor = body['editor'];
        if (!isPlainObject(editor)) {
          badRequest(res, 'editor must be an object');
          return;
        }
        if (editor['defaultEditor'] !== undefined) {
          const value = editor['defaultEditor'];
          if (value !== null && !EDITOR_IDS.includes(value as EditorId)) {
            badRequest(res, `editor.defaultEditor must be one of ${EDITOR_IDS.join(', ')} or null`);
            return;
          }
          partial.editor = { defaultEditor: value as EditorId | null };
        }
      }

      if (body['defaultBase'] !== undefined) {
        const value = body['defaultBase'];
        if (value !== null && (typeof value !== 'string' || !value.trim())) {
          badRequest(res, 'defaultBase must be a non-empty string or null');
          return;
        }
        partial.defaultBase = value === null ? null : (value as string).trim();
      }

      const settings = await sourceControlConfigService.updateSettings(partial);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Accounts (doc §2)
  // ════════════════════════════════════════════════════════════════

  // POST /source-control/accounts — connect an account. The token (when the
  // method is `token`) is validated against the host, stored in the secret
  // store and dropped; the response is the client-safe account record.
  router.post('/accounts', async (req, res, next) => {
    try {
      const body: unknown = req.body ?? {};
      if (!isPlainObject(body)) {
        badRequest(res, 'Body must be an object');
        return;
      }

      const provider = body['provider'];
      if (provider !== 'github') {
        badRequest(res, `Unknown provider: ${String(provider)}`);
        return;
      }

      const method = body['method'];
      if (typeof method !== 'string' || !AUTH_METHODS.includes(method as SourceControlAuthMethod)) {
        badRequest(res, `method must be one of ${AUTH_METHODS.join(', ')}`);
        return;
      }

      const token = body['token'];
      if (method === 'token' && (typeof token !== 'string' || !token.trim())) {
        badRequest(res, 'A personal access token is required for token sign-in.');
        return;
      }
      if (token !== undefined && typeof token !== 'string') {
        badRequest(res, 'token must be a string');
        return;
      }

      const host = body['host'];
      if (host !== undefined && typeof host !== 'string') {
        badRequest(res, 'host must be a string');
        return;
      }
      const label = body['label'];
      if (label !== undefined && typeof label !== 'string') {
        badRequest(res, 'label must be a string');
        return;
      }

      const account = await sourceControlConfigService.addAccount({
        provider: provider as ScmProviderId,
        method: method as SourceControlAuthMethod,
        ...(typeof token === 'string' ? { token } : {}),
        ...(host !== undefined ? { host } : {}),
        ...(label !== undefined ? { label } : {}),
      });
      // `account` carries a login/label/host — never the token.
      logger.info(`[SCM] Connected account ${account.id} (${account.authMethod})`, {
        requestId: req.requestId,
      });
      res.status(201).json(account);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /source-control/accounts/:id — forget the account + its token.
  // Idempotent: removing an id that is already gone still answers 204.
  router.delete('/accounts/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      await sourceControlConfigService.removeAccount(id);
      logger.info(`[SCM] Removed account ${id}`, { requestId: req.requestId });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // POST /source-control/accounts/device/start — begin the OAuth device flow.
  // The server polls in the background; the client shows the user code.
  router.post('/accounts/device/start', async (req, res, next) => {
    try {
      const body: unknown = req.body ?? {};
      if (!isPlainObject(body)) {
        badRequest(res, 'Body must be an object');
        return;
      }
      if (body['provider'] !== 'github') {
        badRequest(res, `Unknown provider: ${String(body['provider'])}`);
        return;
      }
      const host = body['host'];
      if (host !== undefined && typeof host !== 'string') {
        badRequest(res, 'host must be a string');
        return;
      }
      const start = await sourceControlConfigService.startDeviceLogin({
        provider: 'github',
        ...(host !== undefined ? { host } : {}),
      });
      res.json(start);
    } catch (err) {
      next(err);
    }
  });

  // GET /source-control/accounts/device/:loginId — poll the device flow.
  router.get('/accounts/device/:loginId', (req, res, next) => {
    try {
      const loginId = String(req.params['loginId']);
      const status = sourceControlConfigService.getDeviceLogin(loginId);
      if (!status) {
        res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: `Device login not found: ${loginId}` } });
        return;
      }
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Legacy surface — kept working for older clients (doc §2, last row)
  // ════════════════════════════════════════════════════════════════

  // GET /source-control/config — current provider selection (token never returned)
  router.get('/config', (_req, res, next) => {
    try {
      res.json(sourceControlConfigService.getConfig());
    } catch (err) {
      next(err);
    }
  });

  // PUT /source-control/config — update provider selection / credentials
  router.put('/config', async (req, res, next) => {
    try {
      const activeProvider = req.body?.activeProvider as ActiveProvider | undefined;
      if (activeProvider && activeProvider !== 'github' && activeProvider !== 'none') {
        badRequest(res, `Unknown provider: ${activeProvider}`);
        return;
      }
      const updated = await sourceControlConfigService.setConfig({
        ...(activeProvider ? { activeProvider } : {}),
        github: req.body?.github,
      });
      logger.info(`[SCM] Config updated — active=${updated.activeProvider}`, { requestId: req.requestId });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /source-control/status — whether the active provider is usable.
  // `enabled` is "at least one account is connected" (doc §2): every account
  // carries a validated token, so this is the same answer the old
  // `isEnabled()` probe gave, without the round trip to the host.
  router.get('/status', (_req, res, next) => {
    try {
      const enabled = sourceControlConfigService.getSettings().accounts.length > 0;
      res.json({ activeProvider: sourceControlService.getActiveProviderId(), enabled });
    } catch (err) {
      next(err);
    }
  });

  // Last line of defence for the "tokens never reach a response or a log"
  // rule. Anything thrown below this router — a host rejection quoting the
  // credential it was handed, a git/`gh` stderr line carrying a remote URL
  // with the token embedded — reaches the app-wide error middleware, which
  // puts `message` in the response AND `stack` in the log. Redacting in
  // place (rather than rethrowing a new error) keeps the error's class, so a
  // `ValidationError` still maps to 400.
  router.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (err instanceof Error) {
      err.message = redactTokens(err.message);
      if (typeof err.stack === 'string') err.stack = redactTokens(err.stack);
    }
    next(err);
  });

  return router;
}
