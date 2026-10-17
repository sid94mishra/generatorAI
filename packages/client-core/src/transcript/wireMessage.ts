// Guard the loose API message metadata once, then share chronological replay
// with every client. This adapter never invents session ids or timestamps.
import type { ChatMessageMetadata, PermissionCardSummary, PlanCardSummary, QuestionCardSummary } from '@generatorai/shared';
import type { ToolFileOp } from '../stream/types.js';
import { chatMessageToBlocks } from './chatMessageToBlocks.js';
import type { TranscriptMessageInput } from './messageInput.js';

const str = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}
function fileOpOf(value: unknown): ToolFileOp | undefined {
  const op = record(value);
  const kind = str(op['kind']);
  const filePath = str(op['filePath']);
  if (!kind || !filePath) return undefined;
  return {
    kind: kind as ToolFileOp['kind'], filePath,
    additions: num(op['additions']) ?? 0, deletions: num(op['deletions']) ?? 0,
    ...(Array.isArray(op['hunks']) ? { hunks: op['hunks'] as ToolFileOp['hunks'] } : {}),
    ...(op['hunksTruncated'] === true ? { hunksTruncated: true } : {}),
  };
}

/** Historical wire variants normalized without changing the shared replay path. */
export function transcriptMessageInput(message: { content: string; metadata?: unknown }): TranscriptMessageInput {
  const raw = record(message.metadata);
  const metadata: ChatMessageMetadata = {};
  if (raw['partial'] === true) metadata.partial = true;
  const turnId = str(raw['turnId']);
  if (turnId) metadata.turnId = turnId;
  for (const key of ['widgetInstanceIds', 'systemMessages'] as const) {
    if (Array.isArray(raw[key])) metadata[key] = raw[key].filter((value): value is string => typeof value === 'string');
  }
  const thinking = str(raw['thinkingText']);
  if (thinking) metadata.thinkingText = thinking;
  metadata.textSegments = records(raw['textSegments']).map((seg) => ({
    content: str(seg['content']) ?? '', sequence: num(seg['sequence']),
  }));
  metadata.toolCalls = records(raw['toolCalls']).filter((tc) => !!str(tc['tool'])).map((tc, index) => ({
    id: str(tc['id']) ?? `meta_tc_${index}`, tool: str(tc['tool'])!, args: tc['args'], result: tc['result'],
    status: 'complete', sequence: num(tc['sequence']), fileOp: fileOpOf(tc['fileOp']), parentId: str(tc['parentId']),
    ...(tc['success'] === false || tc['status'] === 'error' ? { success: false } : {}),
  }));
  // Card payloads are server contracts. Keep their known string status and
  // question payloads, as the legacy clients did; missing values expire.
  metadata.planCards = records(raw['planCards']).filter((card) => !!str(card['planId'])).map((card) => ({
    planId: str(card['planId'])!, revision: num(card['revision']) ?? 1, title: str(card['title']) ?? 'Plan',
    fileName: str(card['fileName']) ?? '', summary: str(card['summary']) ?? '',
    status: (str(card['status']) ?? 'expired') as PlanCardSummary['status'], sequence: num(card['sequence']),
    ...(Array.isArray(card['notes']) ? {
      notes: records(card['notes']).filter((note) => !!str(note['text'])).map((note) => ({
        revision: num(note['revision']) ?? 1, text: str(note['text'])!, sequence: num(note['sequence']),
        decision: note['decision'] === 'approved' ? 'approved' as const : 'changes_requested' as const,
      })),
    } : {}),
  }));
  metadata.questionCards = records(raw['questionCards']).filter((card) => !!str(card['interactionId'])).map((card) => {
    const response = record(card['response']);
    const answers = response['answers'];
    const freeformResponse = str(response['freeformResponse']);
    return {
      interactionId: str(card['interactionId'])!,
      questions: (Array.isArray(card['questions']) ? card['questions'] : []) as QuestionCardSummary['questions'],
      status: (str(card['status']) ?? 'expired') as QuestionCardSummary['status'], sequence: num(card['sequence']),
      ...(answers && typeof answers === 'object' || freeformResponse ? {
        response: { answers: record(answers) as Record<string, string[]>, ...(freeformResponse ? { freeformResponse } : {}) },
      } : {}),
    };
  });
  metadata.permissionCards = records(raw['permissionCards']).filter((card) => !!str(card['interactionId'])).map((card) => ({
    interactionId: str(card['interactionId'])!, toolName: str(card['toolName']) ?? '',
    type: (str(card['type']) ?? '') as PermissionCardSummary['type'], description: str(card['description']) ?? '',
    inputSummary: str(card['inputSummary']) ?? '', status: (str(card['status']) ?? 'expired') as PermissionCardSummary['status'],
    sequence: num(card['sequence']), ...(str(card['message']) ? { message: str(card['message'])! } : {}),
    ...(card['risk'] === 'risky' || card['risk'] === 'standard' ? { risk: card['risk'] } : {}),
    // U-16 (D-147): what "Allow for this chat" remembered, or the rules that allowed a request unasked.
    ...(Array.isArray(card['remembered'])
      ? {
          remembered: records(card['remembered']).flatMap((r) =>
            (r['kind'] === 'command' || r['kind'] === 'tool') && str(r['match']) ? [{ kind: r['kind'] as 'command' | 'tool', match: str(r['match'])! }] : [],
          ),
        }
      : {}),
    ...(card['autoAllowed'] === true ? { autoAllowed: true } : {}),
  }));
  return { content: message.content, metadata };
}

export function wireChatMessageToBlocks<T extends { content: string; metadata?: unknown }>(message: T) {
  return chatMessageToBlocks(transcriptMessageInput(message));
}
export interface MessageAttachment {
  name: string;
  path: string;
  mimeType?: string;
  artifactId?: string;
}
export function messageAttachments(message: object): MessageAttachment[] {
  return records(record(message)['attachments']).flatMap((item) => {
    const name = str(item['name']), path = str(item['path']);
    if (!name || !path) return [];
    const mimeType = str(item['mimeType']), artifactId = str(item['artifactId']);
    return [{ name, path, ...(mimeType ? { mimeType } : {}), ...(artifactId ? { artifactId } : {}) }];
  });
}
export function messageWasStopped<T extends { metadata?: unknown }>(message: T): boolean {
  return record(message.metadata)['partial'] === true;
}
