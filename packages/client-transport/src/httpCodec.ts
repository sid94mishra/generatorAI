// ────────────────────────────────────────────────────────────────
// HTTP/1.1 codec for the relay data plane.
//
// `RelayStreamBridge` on the host pipes relay frames straight into a TCP
// connection to its own loopback listener, so a remote client is speaking
// ORDINARY HTTP to the ordinary Express app. That design is deliberate — it
// means the relay path cannot become a privileged shortcut, because it enters
// through the same front door as a LAN client.
//
// The consequence for us: the mobile client must serialize requests and parse
// responses at the HTTP/1.1 wire level.
//
// ── Scope, deliberately narrow ───────────────────────────────────
// This is not a general HTTP client. It handles exactly what the GeneratorAI
// API emits:
//   * `Content-Length` bodies
//   * `Transfer-Encoding: chunked` (SSE, streamed file reads)
//   * `Connection: close` framing (body ends at EOF)
// It does NOT implement: pipelining, trailers beyond discarding them,
// `100-continue`, or compression (the relay path negotiates none).
//
// Everything here is pure byte manipulation, which is why it is a separate
// module: it is the highest-risk code in the transport and the easiest to
// test exhaustively.
// ────────────────────────────────────────────────────────────────

const CRLF = '\r\n';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bounded so a hostile or broken peer cannot exhaust memory. */
export const MAX_HEADER_BYTES = 64 * 1024;
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export class HttpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpParseError';
  }
}

// ── Request serialization ───────────────────────────────────────

export interface SerializedRequest {
  method: string;
  /** Origin-form target, e.g. `/api/chats?limit=20`. */
  target: string;
  headers: Array<[string, string]>;
  body?: Uint8Array;
}

/**
 * Build the request line + headers + body as one buffer.
 *
 * `host` must be the authority the SERVER believes it is serving. The DPoP
 * proof's `htu` claim is computed from the same origin, and a mismatch shows
 * up as an opaque 401 rather than anything that points at the Host header.
 */
export function serializeRequest(req: SerializedRequest, host: string): Uint8Array {
  const lines: string[] = [`${req.method.toUpperCase()} ${req.target} HTTP/1.1`];

  const seen = new Set<string>();
  for (const [name, value] of req.headers) {
    seen.add(name.toLowerCase());
    lines.push(`${name}: ${value}`);
  }

  if (!seen.has('host')) lines.push(`Host: ${host}`);
  // The bridge opens a fresh TCP connection per relay stream, so keep-alive
  // would just leave the host waiting on a socket that will never be reused.
  if (!seen.has('connection')) lines.push('Connection: close');
  if (!seen.has('accept-encoding')) lines.push('Accept-Encoding: identity');

  const body = req.body;
  if (body && body.byteLength > 0) {
    if (!seen.has('content-length')) lines.push(`Content-Length: ${body.byteLength}`);
  } else if (methodExpectsBody(req.method) && !seen.has('content-length')) {
    // A POST with no body still needs an explicit length, or the server
    // waits for one that never arrives.
    lines.push('Content-Length: 0');
  }

  const head = encoder.encode(lines.join(CRLF) + CRLF + CRLF);
  if (!body || body.byteLength === 0) return head;

  const out = new Uint8Array(head.byteLength + body.byteLength);
  out.set(head, 0);
  out.set(body, head.byteLength);
  return out;
}

function methodExpectsBody(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH';
}

// ── Response parsing ────────────────────────────────────────────

export interface ParsedResponseHead {
  status: number;
  statusText: string;
  headers: Headers;
  /** Bytes consumed by the status line + headers, including the blank line. */
  headEnd: number;
  /** How the body is delimited. */
  framing: 'length' | 'chunked' | 'eof' | 'none';
  contentLength: number;
}

/**
 * Parse the status line and headers.
 *
 * Returns `null` when the buffer does not yet contain the full header block,
 * so a caller can keep reading. That is the normal case on a stream, not an
 * error — treating a short read as a failure is how "works on localhost,
 * breaks over the relay" bugs are born.
 */
export function parseResponseHead(buffer: Uint8Array): ParsedResponseHead | null {
  const headEnd = indexOfDoubleCrlf(buffer);
  if (headEnd < 0) {
    if (buffer.byteLength > MAX_HEADER_BYTES) {
      throw new HttpParseError('Response headers exceeded the maximum size');
    }
    return null;
  }

  const headText = decoder.decode(buffer.subarray(0, headEnd));
  const rawLines = headText.split(CRLF);
  const statusLine = rawLines.shift();
  if (!statusLine) throw new HttpParseError('Empty response');

  const match = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/.exec(statusLine);
  if (!match) throw new HttpParseError(`Malformed status line: ${statusLine.slice(0, 80)}`);

  const status = Number.parseInt(match[1]!, 10);
  const statusText = match[2] ?? '';

  const headers = new Headers();
  // Unfold obs-fold continuation lines before splitting on ':'.
  const folded: string[] = [];
  for (const line of rawLines) {
    if (line.length === 0) continue;
    if ((line.startsWith(' ') || line.startsWith('\t')) && folded.length > 0) {
      folded[folded.length - 1] += ` ${line.trim()}`;
    } else {
      folded.push(line);
    }
  }

  for (const line of folded) {
    const idx = line.indexOf(':');
    if (idx <= 0) throw new HttpParseError(`Malformed header: ${line.slice(0, 80)}`);
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    // `append` preserves repeated headers (Set-Cookie), which `set` would drop.
    headers.append(name, value);
  }

  const transferEncoding = headers.get('transfer-encoding')?.toLowerCase() ?? '';
  const contentLengthRaw = headers.get('content-length');

  let framing: ParsedResponseHead['framing'];
  let contentLength = 0;

  if (bodyIsForbidden(status)) {
    // 1xx/204/304 never carry a body, regardless of what the headers claim.
    framing = 'none';
  } else if (transferEncoding.includes('chunked')) {
    framing = 'chunked';
  } else if (contentLengthRaw !== null) {
    const parsed = Number.parseInt(contentLengthRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new HttpParseError(`Invalid Content-Length: ${contentLengthRaw}`);
    }
    if (parsed > MAX_BODY_BYTES) {
      throw new HttpParseError(`Response body exceeds the maximum size (${parsed})`);
    }
    framing = 'length';
    contentLength = parsed;
  } else {
    framing = 'eof';
  }

  return { status, statusText, headers, headEnd: headEnd + 4, framing, contentLength };
}

function bodyIsForbidden(status: number): boolean {
  return (status >= 100 && status < 200) || status === 204 || status === 304;
}

function indexOfDoubleCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.byteLength; i += 1) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

// ── Chunked decoding ────────────────────────────────────────────

export interface ChunkedResult {
  /** Decoded payload available so far. */
  data: Uint8Array;
  /** Bytes of the input consumed. */
  consumed: number;
  /** True once the terminal zero-length chunk has been seen. */
  complete: boolean;
}

/**
 * Decode as much of a chunked body as is fully present.
 *
 * Incremental by design: SSE arrives as an unbounded chunked body, so the
 * caller feeds bytes as they land and forwards whatever decodes. Returning
 * `consumed` lets the caller retain only the partial tail.
 */
export function decodeChunked(buffer: Uint8Array): ChunkedResult {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const lineEnd = indexOfCrlf(buffer, offset);
    // Size line not fully arrived.
    if (lineEnd < 0) break;

    const sizeLine = decoder.decode(buffer.subarray(offset, lineEnd));
    // Chunk extensions (`;name=value`) are legal and must be ignored.
    const sizeToken = sizeLine.split(';')[0]!.trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeToken)) {
      throw new HttpParseError(`Malformed chunk size: ${sizeLine.slice(0, 40)}`);
    }
    const size = Number.parseInt(sizeToken, 16);
    if (size > MAX_BODY_BYTES) {
      throw new HttpParseError(`Chunk exceeds the maximum size (${size})`);
    }

    const dataStart = lineEnd + 2;

    if (size === 0) {
      // Terminal chunk, then optional trailers, then a final CRLF.
      const trailerEnd = indexOfDoubleCrlf(buffer.subarray(lineEnd)) ;
      if (trailerEnd >= 0) {
        return {
          data: concat(parts, total),
          consumed: lineEnd + trailerEnd + 4,
          complete: true,
        };
      }
      // No trailers: just the bare CRLF after the zero chunk.
      if (buffer.byteLength >= dataStart) {
        return { data: concat(parts, total), consumed: dataStart, complete: true };
      }
      break;
    }

    const dataEnd = dataStart + size;
    // Need the payload AND its trailing CRLF before consuming.
    if (buffer.byteLength < dataEnd + 2) break;

    parts.push(buffer.subarray(dataStart, dataEnd));
    total += size;
    offset = dataEnd + 2;
  }

  return { data: concat(parts, total), consumed: offset, complete: false };
}

function indexOfCrlf(buf: Uint8Array, from: number): number {
  for (let i = from; i + 1 < buf.byteLength; i += 1) {
    if (buf[i] === 13 && buf[i + 1] === 10) return i;
  }
  return -1;
}

export function concat(parts: Uint8Array[], totalLength?: number): Uint8Array {
  const total = totalLength ?? parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Split an absolute URL into the origin-form target and the authority. */
export function splitUrl(url: string): { target: string; host: string } {
  const parsed = new URL(url);
  return {
    target: `${parsed.pathname}${parsed.search}`,
    host: parsed.host,
  };
}

/** Normalize `HeadersInit` into the ordered pairs the serializer wants. */
export function headerPairs(init: HeadersInit | undefined): Array<[string, string]> {
  if (!init) return [];
  if (init instanceof Headers) return [...init.entries()];
  if (Array.isArray(init)) return init.map(([k, v]) => [k, v] as [string, string]);
  return Object.entries(init);
}
