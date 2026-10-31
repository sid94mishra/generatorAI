// The `run_code` tool card (code mode, D-182).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { deriveTimeline, type StreamBlock } from '@generatorai/client-core';
import { parseRunCodeReport, registerToolCard, RUN_CODE_TOOL_CARD, StepList } from '../index.js';

afterEach(cleanup);

const report = {
  ok: true,
  result: { count: 2 },
  logs: ['found 2'],
  calls: [
    { tool: 'list_items', ok: true, ms: 12 },
    { tool: 'read_item', ok: false, ms: 1500, error: 'not found' },
  ],
};

describe('parseRunCodeReport', () => {
  it('reads JSON text, objects and MCP text blocks', () => {
    expect(parseRunCodeReport(JSON.stringify(report))?.calls).toHaveLength(2);
    expect(parseRunCodeReport(report)?.result).toEqual({ count: 2 });
    expect(parseRunCodeReport([{ type: 'text', text: JSON.stringify(report) }])?.logs).toEqual(['found 2']);
    expect(parseRunCodeReport({ content: [{ type: 'text', text: JSON.stringify({ ...report, ok: false, error: 'bad' }) }] })).toMatchObject({
      ok: false,
      error: 'bad',
    });
  });

  it('refuses anything else', () => {
    expect(parseRunCodeReport('Error: code is required')).toBeNull();
    expect(parseRunCodeReport({ hits: [] })).toBeNull();
    expect(parseRunCodeReport(undefined)).toBeNull();
  });
});

describe('run_code card', () => {
  it('draws the script, the call trace, the logs and the result under a "Ran code" row', () => {
    const off = registerToolCard(RUN_CODE_TOOL_CARD);
    const blocks: StreamBlock[] = [
      {
        type: 'tool_call',
        blockId: 1,
        callId: 'c1',
        tool: 'mcp__generatorai-tools__run_code',
        args: { code: 'const r = await tools.list_items({});\nreturn { count: r.length };' },
        result: JSON.stringify(report),
        status: 'complete',
      },
    ];
    render(
      <MemoryRouter>
        <StepList steps={deriveTimeline(blocks, { active: false })} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Ran code')).toBeInTheDocument();
    const card = screen.getByTestId('run-code-card');
    expect(card).toHaveTextContent('Script');
    expect(screen.getByTestId('run-code-summary')).toHaveTextContent('2 tool calls');
    expect(screen.getByTestId('run-code-summary')).toHaveTextContent('1 failed');
    const calls = screen.getByTestId('run-code-calls');
    expect(calls).toHaveTextContent('List items');
    expect(calls).toHaveTextContent('Failed');
    expect(calls).toHaveTextContent('not found');
    expect(calls).toHaveTextContent('1.5 s');
    expect(card).toHaveTextContent('Logs');
    expect(card).toHaveTextContent('Result');
    off();
  });
});
