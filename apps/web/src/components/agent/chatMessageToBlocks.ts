// ────────────────────────────────────────────────────────────────
// chatMessageToBlocks — Adapter: persisted ChatMessage → StreamBlock[].
//
// Produces the same block shapes streamStore emits so a replayed
// assistant turn renders through the exact same pipeline as a live
// one: chatMessageToBlocks → deriveStreamView → <StreamPanel>.
//
// Block ORDER is the contract — `deriveSegments` walks the array and
// renders what it finds, in place — so this adapter owns the job of
// restoring the turn's true chronology.
//
// Sources, in render order (matches the old AssistantMessage):
//  1. metadata.thinkingText   → one completed ThinkingBlock
//  2. tool calls + plan/question cards, interleaved by the turn ordinal
//     the server stamped on each (`sequence`)
//  3. message.content         → TextBlock, or interleaved text/tool_call
//     blocks when the model embedded <tool_calls>/<function_calls> XML
//     (parsed by the same utils/parseInlineToolCalls streamStore uses).
//
// `content` is the turn's FINAL assistant text, so it always closes the
// message.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import type { StreamBlock } from '@/stores/streamStore.js';
import { parseInlineToolCalls } from '@generatorai/client-core';

/** A block awaiting its blockId, tagged with the turn ordinal it sorts on. */
interface OrderedBlock {
  sequence: number | undefined;
  make: (blockId: number) => StreamBlock;
}

export function chatMessageToBlocks(message: ChatMessage): StreamBlock[] {
  const blocks: StreamBlock[] = [];
  let nextId = 0;

  const metadata = message.metadata;

  // 1. Persisted thinking — always complete in history.
  if (metadata?.thinkingText) {
    blocks.push({
      type: 'thinking',
      blockId: nextId++,
      text: metadata.thinkingText,
      isComplete: true,
    });
  }

  // 2. Everything the agent DID, in the order it happened.
  const ordered: OrderedBlock[] = [];

  // Tool calls. Status is coerced to 'complete': a persisted message can carry
  // status 'running' when a turn was paused/aborted mid-call, but rendering
  // that as running would show a spinner forever.
  let toolCounter = 0;
  for (const tc of metadata?.toolCalls ?? []) {
    const fallbackId = `meta_tc_${toolCounter++}`;
    ordered.push({
      sequence: tc.sequence,
      make: (blockId) => ({
        type: 'tool_call',
        blockId,
        callId: tc.id ?? fallbackId,
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
        status: 'complete',
      }),
    });
  }

  // PLN-01 — plan and question cards.
  //
  // These MUST come from message metadata rather than event replay: for a
  // completed chat, replayEvents.ts takes its fast path and never processes
  // the `chat.plan.*` / `chat.question.*` events, so the metadata is the only
  // surviving record of the cards.
  for (const card of metadata?.planCards ?? []) {
    ordered.push({
      sequence: card.sequence,
      make: (blockId) => ({
        type: 'plan',
        blockId,
        planId: card.planId,
        revision: card.revision,
        title: card.title,
        fileName: card.fileName,
        summary: card.summary,
        status: card.status,
        actions: [],
      }),
    });
  }

  for (const card of metadata?.questionCards ?? []) {
    ordered.push({
      sequence: card.sequence,
      make: (blockId) => ({
        type: 'question',
        blockId,
        interactionId: card.interactionId,
        questions: card.questions,
        // A card persisted as 'pending' can never become answerable again —
        // the SDK callback it was blocking is gone. Show it as expired.
        status: card.status === 'pending' ? 'expired' : card.status,
        ...(card.response?.answers ? { answers: card.response.answers } : {}),
        ...(card.response?.freeformResponse
          ? { freeformResponse: card.response.freeformResponse }
          : {}),
      }),
    });
  }

  // Messages persisted before the ordinal existed carry no sequence at all.
  // Array#sort is stable, so those keep their append order (tools, then plans,
  // then questions) and simply trail the ones that do carry an ordinal.
  ordered.sort(
    (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
  );
  for (const item of ordered) {
    blocks.push(item.make(nextId++));
  }

  // 3. Content — either plain markdown or text interleaved with inline
  //    <tool_calls>/<function_calls> XML.
  const content = message.content ?? '';
  const segments = parseInlineToolCalls(content);
  if (segments) {
    let inlineCounter = 0;
    for (const seg of segments) {
      if (seg.type === 'text' && seg.content) {
        blocks.push({ type: 'text', blockId: nextId++, content: seg.content });
      } else if (seg.type === 'tool_call' && seg.toolCall) {
        blocks.push({
          type: 'tool_call',
          blockId: nextId++,
          callId: `inline_tc_${inlineCounter++}`,
          tool: seg.toolCall.name,
          args: seg.toolCall.args,
          result: seg.toolCall.result,
          status: 'complete',
        });
      }
    }
  } else if (content) {
    blocks.push({ type: 'text', blockId: nextId++, content });
  }

  return blocks;
}
