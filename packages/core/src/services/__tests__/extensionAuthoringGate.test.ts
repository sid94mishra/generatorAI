// ────────────────────────────────────────────────────────────────
// Review 5.3 — extension-authoring tools are not an implicit capability.
//
// `write_extension` writes an arbitrary file tree and `reload_extension`
// imports it INTO THE SERVER'S OWN PROCESS — it inherits the vault key and
// every token the server can reach, and it survives a reboot. Both were
// registered on the process-wide custom-tool registry, and the wiring comment
// said so plainly: "every chat conversation gets them automatically". Combined
// with permission modes that did nothing, that made host code execution
// reachable from an ordinary chat prompt.
//
// The tools are now filtered out unless the chat's agent grants the
// `extensionAuthoring` capability, which defaults to false.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { isExtensionAuthorToolName, EXTENSION_AUTHOR_TOOL_NAMES } from '../../tools/extensionAuthorTools.js';
import { DEFAULT_AGENT_TOOL_POLICY } from '@generatorai/shared';

describe('extension-authoring capability (review 5.3)', () => {
  it('is OFF by default, so an ordinary chat cannot load code into the server', () => {
    expect(DEFAULT_AGENT_TOOL_POLICY.extensionAuthoring).toBe(false);
  });

  it('names exactly the two tools that hot-load model-written code', () => {
    expect([...EXTENSION_AUTHOR_TOOL_NAMES]).toEqual(['write_extension', 'reload_extension']);
  });

  it('recognises those tools, and only those, as authoring tools', () => {
    expect(isExtensionAuthorToolName('write_extension')).toBe(true);
    expect(isExtensionAuthorToolName('reload_extension')).toBe(true);
    // Ordinary tools must not be swept up by the filter.
    for (const name of ['render_widget', 'read_widget', 'open_browser_page', '']) {
      expect(isExtensionAuthorToolName(name)).toBe(false);
    }
  });

  it('filters the authoring pair out of a tool list when the capability is off', () => {
    // Mirrors `ChatManagementService.selectCustomTools`.
    const registry = [
      { name: 'write_extension' },
      { name: 'reload_extension' },
      { name: 'some_user_tool' },
    ];
    const withoutCapability = registry.filter((t) => !isExtensionAuthorToolName(t.name));
    expect(withoutCapability.map((t) => t.name)).toEqual(['some_user_tool']);
  });
});
