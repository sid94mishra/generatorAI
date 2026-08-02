// ────────────────────────────────────────────────────────────────
// chatMessageToBlocks — Adapter: persisted ChatMessage → StreamBlock[].
//
// Produces the same block shapes streamStore emits so a replayed
// assistant turn renders through the exact same pipeline as a live
// one: chatMessageToBlocks → deriveStreamView → <StreamPanel>.
//
// Sources, in render order (matches the old AssistantMessage):
//  1. metadata.thinkingText   → one completed ThinkingBlock
//  2. metadata.toolCalls      → ToolCallBlock[] (forced complete — see below)
//  3. message.content         → TextBlock, or interleaved text/tool_call
//     blocks when the model embedded <tool_calls>/<function_calls> XML
//     (parsed by the same utils/parseInlineToolCalls streamStore uses).
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import type { StreamBlock } from '@/stores/streamStore.js';
import { parseInlineToolCalls } from '@generatorai/client-core';

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

  // 2. Persisted tool calls. Status is coerced to 'complete': a persisted
  //    message can carry status 'running' when a turn was paused/aborted
  //    mid-call, but rendering that as running would show a spinner forever.
  if (metadata?.toolCalls?.length) {
    for (const tc of metadata.toolCalls) {
      blocks.push({
        type: 'tool_call',
        blockId: nextId++,
        callId: tc.id ?? `meta_tc_${nextId}`,
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
        status: 'complete',
      });
    }
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

  // 4. PLN-01 — plan and question cards.
  //
  // These MUST come from message metadata rather than event replay: for a
  // completed chat, replayEvents.ts takes its fast path and never processes
  // the `chat.plan.*` / `chat.question.*` events, so the metadata is the only
  // surviving record of the cards.
  if (metadata?.planCards?.length) {
    for (const card of metadata.planCards) {
      blocks.push({
        type: 'plan',
        blockId: nextId++,
        planId: card.planId,
        revision: card.revision,
        title: card.title,
        fileName: card.fileName,
        summary: card.summary,
        status: card.status,
        actions: [],
      });
    }
  }

  if (metadata?.questionCards?.length) {
    for (const card of metadata.questionCards) {
      blocks.push({
        type: 'question',
        blockId: nextId++,
        interactionId: card.interactionId,
        questions: card.questions,
        // A card persisted as 'pending' can never become answerable again —
        // the SDK callback it was blocking is gone. Show it as expired.
        status: card.status === 'pending' ? 'expired' : card.status,
        ...(card.response?.answers ? { answers: card.response.answers } : {}),
        ...(card.response?.freeformResponse
          ? { freeformResponse: card.response.freeformResponse }
          : {}),
      });
    }
  }

  return blocks;
}
