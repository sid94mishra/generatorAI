// ────────────────────────────────────────────────────────────────
// computerUseBlocklist (matching) — decides whether an app is off-limits
// for the computer-use feature. Data lives in
// `constants/computerUseBlocklist.ts`; this is the logic half, mirroring
// the existing `constants` / `utils/hostMatcher.ts` split.
//
// Everything here fails CLOSED. App names and window titles are attacker-
// controlled strings, so the normaliser is the real security boundary:
// without NFKC folding, zero-width stripping and a confusables map,
// "Bit\u200Bwarden" and "1Passwοrd" (Greek omicron) walk straight past a
// naive `toLowerCase().includes()`.
// ────────────────────────────────────────────────────────────────

import {
  BLOCKED_BUNDLE_IDS,
  BLOCKED_EXECUTABLES,
  BLOCKED_NAME_FRAGMENTS,
  BLOCKED_WORD_FRAGMENTS,
  SELF_BUNDLE_IDS,
  SELF_EXECUTABLES,
  SELF_NAME_FRAGMENTS,
} from '../constants/computerUseBlocklist.js';

export interface ComputerUseBlocklist {
  readonly bundleIds: readonly string[];
  readonly nameFragments: readonly string[];
  /** Matched on word boundaries — for fragments too short to substring-match. */
  readonly wordFragments: readonly string[];
  readonly executables: readonly string[];
}

export const DEFAULT_COMPUTER_USE_BLOCKLIST: ComputerUseBlocklist = Object.freeze({
  bundleIds: BLOCKED_BUNDLE_IDS,
  nameFragments: BLOCKED_NAME_FRAGMENTS,
  wordFragments: BLOCKED_WORD_FRAGMENTS,
  executables: BLOCKED_EXECUTABLES,
});

/** Invisible formatting characters that carry no meaning but break matching. */
const INVISIBLE_RE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

/**
 * Homoglyphs that render identically to a Latin letter. Folding these is what
 * stops `1Passwοrd` (Greek omicron) and `Теrminal` (Cyrillic Т/е) from
 * evading every substring check. Fullwidth and other compatibility forms are
 * already handled by the NFKC pass, so only the Cyrillic and Greek blocks are
 * listed here.
 *
 * Written as two parallel strings rather than an object literal because most
 * of these code points are not valid JS identifiers.
 */
const CONFUSABLE_FROM = 'авсенкморѕтухіјԁԛԝɡαβεικνορτυχγζημσ';
const CONFUSABLE_TO   = 'abcehkmopstyxijdqwgabeikvoptuxyznmo';

const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  [...CONFUSABLE_FROM].map((ch, i) => [ch, CONFUSABLE_TO[i] as string]),
);

/**
 * Canonical form used for every comparison on both sides.
 *
 * NFKC first so fullwidth/compatibility forms collapse to ASCII, then strip
 * invisibles, then fold confusables, then collapse whitespace. Order matters:
 * folding before NFKC would miss fullwidth Cyrillic.
 */
export function normaliseAppText(value: string): string {
  let out = value.normalize('NFKC').replace(INVISIBLE_RE, '').toLowerCase();
  let folded = '';
  for (const ch of out) folded += CONFUSABLES.get(ch) ?? ch;
  out = folded.replace(/\s+/gu, ' ').trim();
  return out;
}

/**
 * Basename of a path, tolerant of `/`, `\`, UNC prefixes, trailing separators,
 * and the trailing dots/spaces Windows silently ignores (`cmd.exe.` opens cmd).
 */
export function executableBasename(value: string): string {
  const cleaned = normaliseAppText(value).replace(/\\/gu, '/').replace(/\/+$/u, '');
  const last = cleaned.slice(cleaned.lastIndexOf('/') + 1);
  return last.replace(/[. ]+$/u, '').replace(/\.exe$/u, '');
}

const SELF_SET: ReadonlySet<string> = new Set(
  [...SELF_BUNDLE_IDS, ...SELF_EXECUTABLES].map(normaliseAppText),
);
const SELF_FRAGMENTS: readonly string[] = SELF_NAME_FRAGMENTS.map(normaliseAppText);
const SELF_FRAGMENT_SET: ReadonlySet<string> = new Set(SELF_FRAGMENTS);

/** Prevents a `wordFragments` entry from matching inside a longer word. */
function containsWord(haystack: string, word: string): boolean {
  const index = haystack.indexOf(word);
  if (index === -1) return false;
  const before = haystack[index - 1];
  const after = haystack[index + word.length];
  const isBoundary = (ch: string | undefined): boolean => ch === undefined || !/[a-z0-9]/u.test(ch);
  return isBoundary(before) && isBoundary(after);
}

export interface BlocklistCandidate {
  /** Bundle id / AUMID / desktop-file id. */
  id?: string | null;
  name?: string | null;
  /** Every window title belonging to the app, not just the focused one. */
  windowTitles?: readonly (string | null | undefined)[] | null;
  /** Absolute path to the executable, when the provider exposes it. */
  executablePath?: string | null;
}

export interface BlocklistVerdict {
  blocked: boolean;
  /** Which field triggered the match — recorded in the audit row. */
  matchedOn?: 'bundleId' | 'name' | 'windowTitle' | 'executable' | 'self';
  /**
   * The BLOCKLIST entry that matched — never candidate-supplied text, so this
   * is safe to write straight into an audit row or an event payload.
   */
  matchedValue?: string;
}

export interface BlocklistOptions {
  blocklist?: ComputerUseBlocklist;
  /**
   * Exact bundle ids / AUMIDs the user has explicitly trusted. Names and window
   * titles are deliberately not accepted: those are the spoofable fields, and
   * an escape hatch that accepts them is not an escape hatch, it is the bypass.
   *
   * An allowlist entry suppresses the id / executable / name checks only.
   * Window titles are ALWAYS scanned, because the reason titles are checked at
   * all is that a trusted host process (a browser, an Electron shell) can
   * surface an untrusted vault popup.
   */
  allowlist?: readonly string[];
}

function matchFragments(
  haystack: string,
  blocklist: ComputerUseBlocklist,
  options: { excludeSelf?: boolean } = {},
): string | undefined {
  if (!haystack) return undefined;
  for (const fragment of blocklist.nameFragments) {
    const needle = normaliseAppText(fragment);
    if (options.excludeSelf && SELF_FRAGMENT_SET.has(needle)) continue;
    if (needle && haystack.includes(needle)) return fragment;
  }
  for (const fragment of blocklist.wordFragments) {
    const needle = normaliseAppText(fragment);
    if (options.excludeSelf && SELF_FRAGMENT_SET.has(needle)) continue;
    if (needle && containsWord(haystack, needle)) return fragment;
  }
  return undefined;
}

/**
 * Decides whether a candidate app is off-limits.
 *
 * Every field is checked independently and a hit on ANY of them blocks: an app
 * that renames itself still carries its bundle id, one that spoofs its bundle
 * id still shows a recognisable window title, and one that hides both still
 * runs from a recognisable executable.
 */
export function evaluateBlocklist(
  candidate: BlocklistCandidate,
  options: BlocklistOptions = {},
): BlocklistVerdict {
  const blocklist = options.blocklist ?? DEFAULT_COMPUTER_USE_BLOCKLIST;

  const id = typeof candidate.id === 'string' ? normaliseAppText(candidate.id) : '';
  const name = typeof candidate.name === 'string' ? normaliseAppText(candidate.name) : '';
  const exePath = typeof candidate.executablePath === 'string' ? candidate.executablePath : '';
  const exeNames = [exePath, candidate.id ?? '']
    .filter((v) => v.length > 0)
    .map(executableBasename)
    .filter((v) => v.length > 0);

  // Our own windows are unconditionally off-limits — an allowlist entry must
  // never let the agent click "Allow" on the consent dialog gating its own
  // next action.
  if (id && SELF_SET.has(id)) return { blocked: true, matchedOn: 'self', matchedValue: id };
  for (const exe of exeNames) {
    if (SELF_SET.has(exe)) return { blocked: true, matchedOn: 'self', matchedValue: exe };
  }
  for (const fragment of SELF_FRAGMENTS) {
    if (name.includes(fragment)) return { blocked: true, matchedOn: 'self', matchedValue: fragment };
  }

  const allowed = new Set(
    (options.allowlist ?? [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normaliseAppText)
      .filter((entry) => entry.length > 0 && !SELF_SET.has(entry)),
  );
  const isAllowlisted = id.length > 0 && allowed.has(id);

  if (!isAllowlisted) {
    for (const bundleId of blocklist.bundleIds) {
      if (id && id === normaliseAppText(bundleId)) {
        return { blocked: true, matchedOn: 'bundleId', matchedValue: bundleId };
      }
    }

    for (const exe of exeNames) {
      for (const blockedExe of blocklist.executables) {
        if (exe === executableBasename(blockedExe)) {
          return { blocked: true, matchedOn: 'executable', matchedValue: blockedExe };
        }
      }
    }

    // The id and executable basename are run through the fragment list too:
    // many providers expose only one of these, and a candidate with no `name`
    // would otherwise skip the fragment check entirely.
    for (const haystack of [name, id, ...exeNames]) {
      const hit = matchFragments(haystack, blocklist);
      if (hit) {
        return {
          blocked: true,
          matchedOn: haystack === name ? 'name' : 'executable',
          matchedValue: hit,
        };
      }
    }
  }

  // Our OWN name is deliberately not matched here, though every other fragment
  // is. Self-blocking exists so the agent cannot drive our app and approve its
  // own consent prompts — that is process identity, which the bundle id and
  // executable checks above establish. A title bar merely mentioning us proves
  // nothing: a user with our repo open in their editor, our docs in a browser
  // tab, or a folder named after us would otherwise have those windows blocked
  // and hidden from `listApps`. Credential fragments still scan titles, because
  // there the title is the only signal a vault popup is hosted in a browser.
  for (const rawTitle of candidate.windowTitles ?? []) {
    if (typeof rawTitle !== 'string') continue;
    const hit = matchFragments(normaliseAppText(rawTitle), blocklist, { excludeSelf: true });
    if (hit) return { blocked: true, matchedOn: 'windowTitle', matchedValue: hit };
  }

  return { blocked: false };
}

/**
 * Builds the effective blocklist from config. Config can only ADD — the
 * built-in lists are always unioned in, so an empty or hostile config value
 * cannot disarm the control.
 */
export function buildBlocklist(extra?: {
  bundleIds?: readonly string[];
  nameFragments?: readonly string[];
  executables?: readonly string[];
}): ComputerUseBlocklist {
  return Object.freeze({
    bundleIds: [...BLOCKED_BUNDLE_IDS, ...(extra?.bundleIds ?? [])],
    nameFragments: [...BLOCKED_NAME_FRAGMENTS, ...(extra?.nameFragments ?? [])],
    wordFragments: BLOCKED_WORD_FRAGMENTS,
    executables: [...BLOCKED_EXECUTABLES, ...(extra?.executables ?? [])],
  });
}
