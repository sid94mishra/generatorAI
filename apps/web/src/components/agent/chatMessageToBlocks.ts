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
//  2. text segments, tool calls and plan/question cards, interleaved by the
//     turn ordinal the server stamped on each (`sequence`)
//  3. message.content         → TextBlock, or interleaved text/tool_call
//     blocks when the model embedded <tool_calls>/<function_calls> XML
//     (parsed by the same utils/parseInlineToolCalls streamStore uses).
//
// `content` is the turn's FINAL assistant text. When `metadata.textSegments`
// is present it already ends with that text, so step 3 is skipped to avoid
// printing the closing paragraph twice.
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

  // Assistant narration between tool waves. Present only on turns that said
  // more than their closing paragraph.
  const textSegments = metadata?.textSegments ?? [];
  for (const seg of textSegments) {
    if (!seg.content?.trim()) continue;
    ordered.push({
      sequence: seg.sequence,
      make: (blockId) => ({ type: 'text', blockId, content: seg.content }),
    });
  }

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
        ...(tc.fileOp ? { fileOp: tc.fileOp } : {}),
        ...(tc.parentId ? { parentCallId: tc.parentId } : {}),
        ...(tc.success === false ? { error: true } : {}),
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
        // Mirror the question-card rule below: a card persisted while still
        // awaiting review is not actionable from history — the gate it was
        // blocking has since been resolved or expired (turns only persist
        // after they settle). Rendering it as "Needs review" produced an
        // approvable-looking card whose click 409s (seen after a mid-review
        // server restart).
        status: card.status === 'awaiting_review' || card.status === 'drafting'
          ? 'expired'
          : card.status,
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

  // Review finding 5.1 — tool-permission cards, same replay rule as
  // plan/question above: a card persisted as 'pending' has long since had
  // its blocking SDK callback torn down (turns only persist after they
  // settle), so it renders as expired rather than a clickable-looking dead
  // end.
  for (const card of metadata?.permissionCards ?? []) {
    ordered.push({
      sequence: card.sequence,
      make: (blockId) => ({
        type: 'permission',
        blockId,
        interactionId: card.interactionId,
        toolName: card.toolName,
        permissionType: card.type,
        description: card.description,
        inputSummary: card.inputSummary,
        permissionMode: '',
        status: card.status === 'pending' ? 'expired' : card.status,
        ...(card.message ? { message: card.message } : {}),
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
  //    Skipped when ordered segments already carried the narration, which
  //    ends with this same closing text.
  if (textSegments.length > 0) return blocks;

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
