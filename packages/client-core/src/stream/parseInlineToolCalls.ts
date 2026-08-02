// ────────────────────────────────────────────────────────────────
// parseInlineToolCalls — Extract tool calls from inline XML in content
// Used when the model outputs <function_calls> XML in the token stream
// instead of using the SDK's tool execution protocol.
// ────────────────────────────────────────────────────────────────

export interface InlineToolCall {
  name: string;
  args: Record<string, string>;
  result?: string;
}

export interface ParsedContentSegment {
  type: 'text' | 'tool_call';
  content?: string;
  toolCall?: InlineToolCall;
}

/**
 * Parse message content containing <function_calls> or <tool_calls> XML
 * into structured segments of text and tool calls.
 *
 * Returns null if no inline tool calls are found.
 */
export function parseInlineToolCalls(content: string): ParsedContentSegment[] | null {
  if (!/<tool_calls>/.test(content) && !/<function_calls>/.test(content)) return null;

  const segmentPattern = /(<tool_calls>[\s\S]*?<\/tool_calls>|<function_calls>[\s\S]*?<\/function_calls>|<(?:tool_response|function_response)>[\s\S]*?(?:<\/(?:tool_response|function_response)>|(?=<(?:tool_calls|function_calls)>)|$))/g;
  const segments: ParsedContentSegment[] = [];
  let lastIndex = 0;
  let pendingToolCall: InlineToolCall | null = null;

  for (const match of content.matchAll(segmentPattern)) {
    const matchStart = match.index!;
    const segment = match[0];

    // Add text before this segment
    if (matchStart > lastIndex) {
      const text = content.slice(lastIndex, matchStart).trim();
      if (text) {
        if (pendingToolCall) {
          segments.push({ type: 'tool_call', toolCall: pendingToolCall });
          pendingToolCall = null;
        }
        segments.push({ type: 'text', content: text });
      }
    }

    if (segment.startsWith('<tool_calls>') || segment.startsWith('<function_calls>')) {
      // Flush any pending tool call without a response
      if (pendingToolCall) {
        segments.push({ type: 'tool_call', toolCall: pendingToolCall });
        pendingToolCall = null;
      }

      // Extract ALL invocations from this function_calls block
      const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
      for (const invokeMatch of segment.matchAll(invokePattern)) {
        const toolName = invokeMatch[1]!;
        const invokeBody = invokeMatch[2]!;
        const args: Record<string, string> = {};
        const paramPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
        for (const pm of invokeBody.matchAll(paramPattern)) {
          args[pm[1]!] = pm[2]!;
        }
        // Each invocation becomes a separate pending tool call
        if (pendingToolCall) {
          segments.push({ type: 'tool_call', toolCall: pendingToolCall });
        }
        pendingToolCall = { name: toolName, args };
      }

      // Fallback: if no <invoke> found, extract from the block-level attributes
      if (!pendingToolCall) {
        const nameMatch = segment.match(/<invoke\s+name="([^"]+)"/);
        const toolName = nameMatch?.[1] ?? 'unknown';
        const args: Record<string, string> = {};
        const paramPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
        for (const pm of segment.matchAll(paramPattern)) {
          args[pm[1]!] = pm[2]!;
        }
        pendingToolCall = { name: toolName, args };
      }
    } else if (segment.startsWith('<tool_response>') || segment.startsWith('<function_response>')) {
      const tagLen = segment.startsWith('<function_response>') ? '<function_response>'.length : '<tool_response>'.length;
      const responseContent = segment.slice(tagLen);
      const result = responseContent
        .replace(/<session_id>[\s\S]*?<\/session_id>/g, '')
        .replace(/<system>[\s\S]*?<\/system>/g, '')
        .replace(/<stdout>/g, '').replace(/<\/stdout>/g, '')
        .replace(/<stderr>/g, '[stderr] ').replace(/<\/stderr>/g, '')
        .replace(/<\/(?:tool_response|function_response)>/g, '')
        .trim() || undefined;
      if (pendingToolCall) {
        pendingToolCall.result = result;
        segments.push({ type: 'tool_call', toolCall: pendingToolCall });
        pendingToolCall = null;
      }
    }

    lastIndex = matchStart + segment.length;
  }

  // Flush pending tool call
  if (pendingToolCall) {
    segments.push({ type: 'tool_call', toolCall: pendingToolCall });
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: 'text', content: text });
  }

  return segments.length > 0 ? segments : null;
}
