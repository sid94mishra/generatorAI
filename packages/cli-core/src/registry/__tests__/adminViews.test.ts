// ────────────────────────────────────────────────────────────────
// Administration views, checked against the REAL registry.
//
// This is the test the whole design exists for: twelve hand-built admin
// panes would each name a command inside a component, and a renamed or
// removed command would only surface when a user opened that one pane. A
// declared table can be walked in full, so a view pointing at a command that
// does not exist fails here instead.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../commands/index.js';
import {
  ADMIN_VIEWS,
  adminViewColumns,
  resolveAdminView,
  unresolvableAdminViews,
} from '../adminViews.js';

const registry = buildRegistry();

describe('admin views', () => {
  it('every view names a command that really exists', () => {
    expect(unresolvableAdminViews(registry)).toEqual([]);
  });

  it('covers every surface the audit lists', () => {
    // The audit's §12 Phase 8 item 5 sentence, one id per named surface.
    const required = [
      'extensions',
      'agents',
      'skills',
      'prompts',
      'mcp',
      'hooks',
      'webhooks',
      'providers',
      'connections',
      'devices',
      'security-posture',
      'doctor',
    ];
    for (const id of required) {
      expect(resolveAdminView(id), `missing admin view: ${id}`).toBeDefined();
    }
  });

  it('has unique ids', () => {
    const ids = ADMIN_VIEWS.map((view) => view.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes each view's columns from the command's own output spec", () => {
    // The point of deriving them: a view cannot advertise a column the
    // command does not return.
    const devices = resolveAdminView('devices')!;
    const spec = registry.get(devices.command)!;
    expect(adminViewColumns(spec)).toBe(spec.output.columns);
  });

  it('falls back to an id column rather than rendering an empty table', () => {
    // A `Table` with no columns paints nothing, which reads as "no data"
    // instead of "no column spec".
    expect(adminViewColumns(undefined)).toEqual([
      { key: 'id', header: 'ID', format: 'id', priority: 0 },
    ]);
  });

  it('only presets flags the command actually declares', () => {
    // A preset flag the schema strips is silently ignored — exactly the
    // wire-contract failure mode this repo has been fixing all along.
    for (const view of ADMIN_VIEWS) {
      const spec = registry.get(view.command)!;
      for (const flag of Object.keys(view.flags ?? {})) {
        expect(
          spec.flags.some((f) => f.name === flag),
          `${view.id} presets --${flag}, which ${view.command} does not declare`,
        ).toBe(true);
      }
      for (const arg of Object.keys(view.args ?? {})) {
        expect(
          spec.args.some((a) => a.name === arg),
          `${view.id} presets ${arg}, which ${view.command} does not take`,
        ).toBe(true);
      }
    }
  });

  it('prompts for every required argument it does not preset', () => {
    // Otherwise the pane fires the command blind and the user gets a schema
    // error they did not cause — the exact behaviour the palette's old
    // blind-fire path produced.
    for (const view of ADMIN_VIEWS) {
      const spec = registry.get(view.command)!;
      const required = spec.args.filter((arg) => arg.required).map((arg) => arg.name);
      const supplied = new Set([...Object.keys(view.args ?? {}), ...(view.prompt ? [view.prompt.arg] : [])]);
      for (const name of required) {
        expect(supplied.has(name), `${view.id} does not supply required arg "${name}"`).toBe(true);
      }
    }
  });

  it('never presets a required FLAG it cannot know, without declaring it', () => {
    for (const view of ADMIN_VIEWS) {
      const spec = registry.get(view.command)!;
      const requiredFlags = spec.flags.filter((flag) => flag.required).map((flag) => flag.name);
      for (const name of requiredFlags) {
        expect(
          Object.prototype.hasOwnProperty.call(view.flags ?? {}, name),
          `${view.id} does not supply required flag --${name} of ${view.command}`,
        ).toBe(true);
      }
    }
  });

  it("names a removeCommand argument the command actually takes", () => {
    for (const view of ADMIN_VIEWS) {
      if (!view.removeCommand) continue;
      const spec = registry.get(view.removeCommand.id)!;
      expect(
        spec.args.some((arg) => arg.name === view.removeCommand!.arg),
        `${view.id}'s remove passes "${view.removeCommand.arg}" to ${view.removeCommand.id}`,
      ).toBe(true);
    }
  });
});
