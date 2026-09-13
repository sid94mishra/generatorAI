// ────────────────────────────────────────────────────────────────
// transcript — "Copy transcript" as markdown, client-side.
//
// The server renders the same document for `GET /api/chats/:id/transcript
// ?format=markdown`, but every client already HAS the messages (it fetches
// the JSON transcript to build the copy anyway), so rendering here saves a
// second round trip and — more importantly — keeps web and mobile producing
// byte-identical markdown instead of two lookalike formatters that drift.
//
// Deliberate omissions, mirroring the server:
//   - thinking/reasoning text: it is the model's scratch space, not the
//     conversation, and pasting it into an issue is almost never wanted.
//   - system and tool rows: they are rendered as part of the assistant turn
//     that produced them (the compact "Actions" list), not as their own
//     sections.
// ────────────────────────────────────────────────────────────────

/**
 * The shape this formatter reads.
 *
 * Structural on purpose: `@generatorai/shared`'s `ChatMessage` (web/desktop)
 * and this package's wire `ChatMessage` (mobile) are both assignable to it
 * without either package importing the other's exact type.
 */
export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string | number | Date | undefined;
  createdAt?: string | number | Date | undefined;
  attachments?: ReadonlyArray<{ name: string }> | undefined;
  metadata?:
    | {
        toolCalls?:
          | ReadonlyArray<{
              tool: string;
              args?: unknown;
              fileOp?: { additions?: number; deletions?: number } | undefined;
              success?: boolean | undefined;
            }>
          | undefined;
        textSegments?: ReadonlyArray<{ content: string }> | undefined;
        partial?: boolean | undefined;
      }
    | undefined;
}

/** ISO stamp, or '' when the message carries no usable time. */
function isoTime(message: TranscriptMessage): string {
  const raw = message.timestamp ?? message.createdAt;
  if (raw === undefined || raw === null) return '';
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function heading(label: string, when: string): string {
  return when ? `## ${label}  <sub>${when}</sub>` : `## ${label}`;
}

/** The first argument-ish thing worth showing next to a tool name. */
function toolTarget(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  const candidate =
    (typeof record['file_path'] === 'string' && record['file_path']) ||
    (typeof record['path'] === 'string' && record['path']) ||
    (typeof record['command'] === 'string' && record['command']) ||
    '';
  return candidate ? String(candidate).slice(0, 200) : '';
}

/**
 * Render a whole chat as markdown.
 *
 * @param name     The chat's name — becomes the `#` heading.
 * @param messages The full transcript, oldest first.
 */
export function formatTranscriptMarkdown(
  name: string,
  messages: readonly TranscriptMessage[],
): string {
  const out: string[] = [`# ${name}`, ''];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'tool') continue;
    const when = isoTime(message);

    if (message.role === 'user') {
      out.push(heading('You', when), '');
      out.push((message.content ?? '').trim(), '');
      if (message.attachments?.length) {
        out.push(
          `*Attachments:* ${message.attachments.map((a) => `\`${a.name}\``).join(', ')}`,
          '',
        );
      }
      continue;
    }

    out.push(heading('Assistant', when), '');

    const tools = message.metadata?.toolCalls ?? [];
    if (tools.length > 0) {
      out.push(`<details><summary>Actions (${String(tools.length)})</summary>`, '');
      for (const call of tools) {
        const target = toolTarget(call.args);
        const op = call.fileOp
          ? ` (+${String(call.fileOp.additions ?? 0)} −${String(call.fileOp.deletions ?? 0)})`
          : '';
        out.push(
          `- \`${call.tool}\`${target ? ` ${target}` : ''}${op}${call.success === false ? ' — failed' : ''}`,
        );
      }
      out.push('', '</details>', '');
    }

    const segments = message.metadata?.textSegments?.length
      ? message.metadata.textSegments.map((s) => s.content)
      : [message.content ?? ''];
    out.push(
      segments
        .map((t) => (t ?? '').trim())
        .filter(Boolean)
        .join('\n\n'),
      '',
    );

    if (message.metadata?.partial) out.push('*Stopped before the response finished.*', '');
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
