// 09 §8.2 fixture: 2,000 transcript blocks — 400 turns, each a user message and
// an assistant response with markdown + a code fence, three step rows (Read,
// Bash, and an Edit carrying a diff) and a closing paragraph.
// Served with `page.route` on the chat's messages endpoint.

export const TURNS = 400;

/** Unique text in turn `i`, for the find check. */
export const needle = (i: number) => `zebra-needle-${i}`;

export function transcriptMessages(chatId: string, sessionId: string): unknown[] {
  const out: unknown[] = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < TURNS; i += 1) {
    const turnId = `perf-turn-${i}`;
    out.push({
      id: `perf-u-${i}`,
      sessionId,
      chatId,
      role: 'user',
      content: `Turn ${i}: fix the flaky checkout test in \`checkout.spec.ts\` (${needle(i)})`,
      timestamp: new Date(t0 + i * 60_000).toISOString(),
      metadata: { turnId },
    });
    out.push({
      id: `perf-a-${i}`,
      sessionId,
      chatId,
      role: 'assistant',
      content: `Done with turn ${i}. The **coupon** request and the total recalculation raced; the total now derives from the coupon response.`,
      timestamp: new Date(t0 + i * 60_000 + 30_000).toISOString(),
      metadata: {
        turnId,
        textSegments: [
          {
            sequence: 0,
            content: `Looking at the race in turn ${i}:\n\n\`\`\`ts\nconst { discount } = await api.applyCoupon(code);\nsetTotals(recalculate(cart, discount));\n\`\`\`\n`,
          },
          {
            sequence: 4,
            content: `Done with turn ${i}. The **coupon** request and the total recalculation raced; the total now derives from the coupon response.`,
          },
        ],
        toolCalls: [
          { id: `r-${i}`, tool: 'Read', args: { file_path: 'tests/checkout.spec.ts' }, result: 'ok', status: 'complete', sequence: 1 },
          { id: `b-${i}`, tool: 'Bash', args: { command: 'pnpm test checkout --repeat 20' }, result: '3 of 20 failed', status: 'complete', sequence: 2 },
          {
            id: `e-${i}`,
            tool: 'Edit',
            args: { file_path: 'src/cart/applyCoupon.ts', old_string: 'const totals = await api.getTotals(cart.id);', new_string: 'const { discount } = await api.applyCoupon(code);' },
            status: 'complete',
            sequence: 3,
            fileOp: { kind: 'edit', filePath: 'src/cart/applyCoupon.ts', additions: 14, deletions: 6 },
          },
        ],
      },
    });
  }
  return out;
}
