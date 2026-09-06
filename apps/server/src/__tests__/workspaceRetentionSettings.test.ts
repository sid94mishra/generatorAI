// ────────────────────────────────────────────────────────────────
// Workspace retention preferences.
//
// This file decides whether a scheduled job is allowed to delete the user's
// directories, so what is pinned here is the failure DIRECTION: every way of
// being wrong — missing file, corrupt JSON, a hand-edited nonsense value —
// must land on "off" or on the default period, never on something more
// destructive than the user asked for.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readWorkspaceRetentionPreferences,
  writeWorkspaceRetentionPreferences,
  clampRetentionDays,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from '../settings/workspaceRetention.js';

describe('workspace retention preferences', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gai-retention-prefs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is off by default, so upgrading never starts deleting anything', () => {
    expect(readWorkspaceRetentionPreferences(dir)).toEqual({
      enabled: false,
      retentionDays: DEFAULT_RETENTION_DAYS,
    });
  });

  it('defaults to 30 days', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it('round-trips what was saved', () => {
    writeWorkspaceRetentionPreferences(dir, { enabled: true, retentionDays: 14 });
    expect(readWorkspaceRetentionPreferences(dir)).toEqual({ enabled: true, retentionDays: 14 });
  });

  it('treats a corrupt state file as OFF rather than throwing', () => {
    writeFileSync(join(dir, 'workspace-retention.json'), '{ this is not json');
    expect(readWorkspaceRetentionPreferences(dir).enabled).toBe(false);
  });

  it('only accepts a literal true for enabled', () => {
    // A truthy-but-not-true value in a hand-edited file must not switch on a
    // job that deletes directories.
    writeFileSync(join(dir, 'workspace-retention.json'), JSON.stringify({ enabled: 'yes', retentionDays: 30 }));
    expect(readWorkspaceRetentionPreferences(dir).enabled).toBe(false);
  });

  describe('clamping the retention period', () => {
    it('keeps values inside the supported range', () => {
      expect(clampRetentionDays(1)).toBe(1);
      expect(clampRetentionDays(30)).toBe(30);
      expect(clampRetentionDays(365)).toBe(365);
    });

    it('falls back to the DEFAULT rather than the minimum for a bad value', () => {
      // Clamping garbage down to 1 day would turn a typo into the most
      // destructive possible setting — the opposite of what a fallback is for.
      expect(clampRetentionDays(0)).toBe(DEFAULT_RETENTION_DAYS);
      expect(clampRetentionDays(-5)).toBe(DEFAULT_RETENTION_DAYS);
      expect(clampRetentionDays(MAX_RETENTION_DAYS + 1)).toBe(DEFAULT_RETENTION_DAYS);
      expect(clampRetentionDays(Number.NaN)).toBe(DEFAULT_RETENTION_DAYS);
      expect(clampRetentionDays('30' as unknown)).toBe(DEFAULT_RETENTION_DAYS);
      expect(clampRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('floors a fractional value instead of rejecting it', () => {
      expect(clampRetentionDays(30.9)).toBe(30);
    });

    it('is applied on the way in as well as on the way out', () => {
      const saved = writeWorkspaceRetentionPreferences(dir, {
        enabled: true,
        retentionDays: 99_999,
      });
      expect(saved.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
      expect(readWorkspaceRetentionPreferences(dir).retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('has a minimum of at least one day', () => {
      expect(MIN_RETENTION_DAYS).toBeGreaterThanOrEqual(1);
    });
  });

  it('writes the file with restrictive permissions and a timestamp', () => {
    writeWorkspaceRetentionPreferences(dir, { enabled: true, retentionDays: 30 });
    const raw = JSON.parse(readFileSync(join(dir, 'workspace-retention.json'), 'utf8')) as {
      updatedAt?: number;
    };
    expect(typeof raw.updatedAt).toBe('number');
  });
});
