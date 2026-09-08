// ────────────────────────────────────────────────────────────────
// chatMessageToBlocks — persisted assistant message → StreamBlock[].
//
// Port of web's adapter. A replayed turn renders through the SAME
// `deriveTimeline` as a live one, which is what makes a chat look identical
// the moment its live blocks are replaced by the refetched transcript —
// previously mobile rendered history as "every tool call, then the text",
// losing the narration the agent wrote between tool waves.
//
// Order is the contract: thinking first, then text segments / tool calls /
// cards interleaved by the turn ordinal the server stamped (`sequence`),
// then `content` unless the segments already carried it.
//
// The mobile `ChatMessage` type keeps `metadata` loose (an index signature),
// so every field is read through a guard rather than trusted.
// ────────────────────────────────────────────────────────────────

import { parseInlineToolCalls, type ChatMessage, type StreamBlock, type ToolFileOp } from '@generatorai/client-core';

interface OrderedBlock {
  sequence: number | undefined;
  make: (blockId: number) => StreamBlock;
}

export interface MessageAttachment {
  name: string;
  path: string;
  mimeType?: string;
  artifactId?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
}

function fileOpOf(v: unknown): ToolFileOp | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const kind = str(o['kind']);
  const filePath = str(o['filePath']);
  if (!kind || !filePath) return undefined;
  const hunks = Array.isArray(o['hunks']) ? (o['hunks'] as ToolFileOp['hunks']) : undefined;
  return {
    kind: kind as ToolFileOp['kind'],
    filePath,
    additions: num(o['additions']) ?? 0,
    deletions: num(o['deletions']) ?? 0,
    ...(hunks ? { hunks } : {}),
    ...(o['hunksTruncated'] === true ? { hunksTruncated: true } : {}),
  };
}

/** Attachments on a user message, if the server sent any. */
export function messageAttachments(message: ChatMessage): MessageAttachment[] {
  const raw = (message as { attachments?: unknown }).attachments;
  const out: MessageAttachment[] = [];
  for (const a of arr(raw)) {
    const name = str(a['name']);
    const path = str(a['path']);
    if (!name || !path) continue;
    const mimeType = str(a['mimeType']);
    const artifactId = str(a['artifactId']);
    out.push({ name, path, ...(mimeType ? { mimeType } : {}), ...(artifactId ? { artifactId } : {}) });
  }
  return out;
}

/** True when the assistant message was cut short by a stop or abort. */
export function messageWasStopped(message: ChatMessage): boolean {
  return message.metadata?.['partial'] === true;
}

export function chatMessageToBlocks(message: ChatMessage): StreamBlock[] {
  const blocks: StreamBlock[] = [];
  let nextId = 0;
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;

  const thinking = str(metadata['thinkingText']);
  if (thinking) blocks.push({ type: 'thinking', blockId: nextId++, text: thinking, isComplete: true });

  const ordered: OrderedBlock[] = [];

  const textSegments = arr(metadata['textSegments']);
  for (const seg of textSegments) {
    const content = str(seg['content']);
    if (!content?.trim()) continue;
    ordered.push({ sequence: num(seg['sequence']), make: (blockId) => ({ type: 'text', blockId, content }) });
  }

  let toolCounter = 0;
  for (const tc of arr(metadata['toolCalls'])) {
    const tool = str(tc['tool']);
    if (!tool) continue;
    const fallbackId = `meta_tc_${toolCounter++}`;
    const fileOp = fileOpOf(tc['fileOp']);
    const parentId = str(tc['parentId']);
    const failed = tc['success'] === false || tc['status'] === 'error';
    ordered.push({
      sequence: num(tc['sequence']),
      make: (blockId) => ({
        type: 'tool_call',
        blockId,
        callId: str(tc['id']) ?? fallbackId,
        tool,
        args: tc['args'],
        result: tc['result'],
        // A persisted 'running' call was paused/aborted mid-flight; a spinner
        // forever would be a lie.
        status: 'complete',
        ...(fileOp ? { fileOp } : {}),
        ...(parentId ? { parentCallId: parentId } : {}),
        ...(failed ? { error: true } : {}),
      }),
    });
  }

  for (const card of arr(metadata['planCards'])) {
    const planId = str(card['planId']);
    if (!planId) continue;
    const status = str(card['status']) ?? 'expired';
    ordered.push({
      sequence: num(card['sequence']),
      make: (blockId) => ({
        type: 'plan',
        blockId,
        planId,
        revision: num(card['revision']) ?? 1,
        title: str(card['title']) ?? 'Plan',
        ...(str(card['fileName']) ? { fileName: str(card['fileName'])! } : {}),
        summary: str(card['summary']) ?? '',
        // A card persisted while still awaiting review is not actionable
        // from history — turns only persist once they settle.
        status: (status === 'awaiting_review' || status === 'drafting' ? 'expired' : status) as never,
        actions: [],
      }),
    });
  }

  for (const card of arr(metadata['questionCards'])) {
    const interactionId = str(card['interactionId']);
    if (!interactionId) continue;
    const response = (card['response'] ?? {}) as Record<string, unknown>;
    ordered.push({
      sequence: num(card['sequence']),
      make: (blockId) => ({
        type: 'question',
        blockId,
        interactionId,
        questions: (Array.isArray(card['questions']) ? card['questions'] : []) as never,
        status: card['status'] === 'pending' ? 'expired' : ((str(card['status']) ?? 'expired') as never),
        ...(response['answers'] && typeof response['answers'] === 'object'
          ? { answers: response['answers'] as Record<string, string[]> }
          : {}),
        ...(str(response['freeformResponse']) ? { freeformResponse: str(response['freeformResponse'])! } : {}),
      }),
    });
  }

  for (const card of arr(metadata['permissionCards'])) {
    const interactionId = str(card['interactionId']);
    if (!interactionId) continue;
    ordered.push({
      sequence: num(card['sequence']),
      make: (blockId) => ({
        type: 'permission',
        blockId,
        interactionId,
        toolName: str(card['toolName']) ?? '',
        permissionType: str(card['type']) ?? '',
        description: str(card['description']) ?? '',
        inputSummary: str(card['inputSummary']) ?? '',
        permissionMode: '',
        status: card['status'] === 'pending' ? 'expired' : ((str(card['status']) ?? 'expired') as never),
        ...(str(card['message']) ? { message: str(card['message'])! } : {}),
      }),
    });
  }

  // Stable sort: items without an ordinal keep append order and trail.
  ordered.sort(
    (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
  );
  for (const item of ordered) blocks.push(item.make(nextId++));

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
