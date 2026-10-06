import { describe, expect, it } from 'vitest';
import { permissionWording } from '../permissionWording.js';

describe('permissionWording (D-107)', () => {
  it('names the action for the built-in kinds', () => {
    expect(permissionWording('Bash', 'shell_exec')).toEqual({ title: 'Run this command?', kindLabel: 'Shell command' });
    expect(permissionWording('shell', 'shell_exec').title).toBe('Run this command?');
    expect(permissionWording('Write', 'file_write')).toEqual({ title: 'Create this file?', kindLabel: 'File change' });
    expect(permissionWording('Edit', 'file_write').title).toBe('Change this file?');
    expect(permissionWording('apply_patch', 'file_write').title).toBe('Change this file?');
    expect(permissionWording('Read', 'file_read')).toEqual({ title: 'Read this file?', kindLabel: 'File read' });
    expect(permissionWording('WebSearch', 'network').title).toBe('Search the web?');
    expect(permissionWording('WebFetch', 'network')).toEqual({ title: 'Fetch this page?', kindLabel: 'Network' });
  });

  it('words the platform tools, bare or through the in-process MCP server, never as "other"', () => {
    expect(permissionWording('open_browser_page', 'other')).toEqual({ title: 'Open a page in the browser?', kindLabel: 'Browser' });
    expect(permissionWording('mcp__generatorai-tools__screenshot_page', 'other')).toEqual({ title: 'Take a screenshot of the page?', kindLabel: 'Browser' });
    expect(permissionWording('render_widget', 'other')).toEqual({ title: 'Show a widget?', kindLabel: 'Widget' });
    expect(permissionWording('computer_click', 'other').kindLabel).toBe('Computer');
  });

  it('names an MCP connector and its tool', () => {
    expect(permissionWording('mcp__github__create_issue', 'other')).toEqual({ title: 'Allow github: Create issue?', kindLabel: 'MCP · github' });
  });

  it('falls back to the tool name in words', () => {
    expect(permissionWording('send_email', 'other')).toEqual({ title: 'Allow Send email?', kindLabel: 'Tool' });
  });
});
