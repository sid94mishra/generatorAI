// ────────────────────────────────────────────────────────────────
// VendorIcons — the single source of truth for AI vendor / provider brand
// marks across the whole app (model picker, settings, chat, anywhere else).
//
// Before this module the same glyphs were duplicated in
// `components/settings/BrandIcons.tsx` and `components/shared/ModelPicker.tsx`,
// and the two had drifted apart — settings showed the Anthropic corporate "A"
// while the picker showed a hand-rolled sunburst. We ship the Claude Code
// mark now, because the agent provider is the Claude Agent SDK (Claude Code),
// not the Anthropic API.
//
// All marks are single-path, `viewBox="0 0 24 24"`, `fill="currentColor"`, so
// they inherit text colour and can be sized with Tailwind height/width
// classes exactly like a lucide icon.
// ────────────────────────────────────────────────────────────────

import React from 'react';

export interface VendorIconProps {
  className?: string;
}

/**
 * Claude's brand orange. Applied as an inline `color` so the mark keeps its
 * identity on any background, while `currentColor` on the path still lets a
 * caller override it (e.g. a selected row that tints everything blue) by
 * passing a `text-*` class.
 */
export const CLAUDE_BRAND_COLOR = '#D97757';

/**
 * Claude Code — the Claude "starburst" mark, in brand orange.
 * Used for the `claude-agent` harness provider and every Claude model.
 */
export function ClaudeCodeMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={{ color: CLAUDE_BRAND_COLOR }}
      aria-hidden
    >
      <path d="M4.709 15.955l4.72-2.647.079-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.729-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}

/**
 * Anthropic — the corporate wordmark glyph, in Claude's brand orange.
 * Kept for anywhere we mean *the company* rather than Claude Code.
 */
export function AnthropicMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={{ color: CLAUDE_BRAND_COLOR }}
      aria-hidden
    >
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.541Zm-.3712 10.181 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

/** GitHub — used for the `copilot` harness provider. */
export function GitHubCopilotMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

/** OpenAI — the model vendor behind the GPT models Copilot serves. */
export function OpenAIMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

/** Google Gemini — the model vendor behind the Gemini models Copilot serves. */
export function GeminiMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81Z" />
    </svg>
  );
}

/**
 * Neutral mark for a provider with no dedicated brand glyph (`codex`,
 * `opencode`, `acp`). W48 — these used to fall through to the GitHub
 * Copilot mark below, which misattributed three unrelated harness
 * providers to a fourth vendor's logo. A plain glyph is honest about
 * "no brand mark yet" instead of borrowing someone else's.
 */
export function GenericProviderMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M8 12h8M12 8v8" strokeLinecap="round" />
    </svg>
  );
}

/** Every vendor mark this app knows, keyed by a stable vendor id. */
export const VENDOR_ICONS = {
  'claude-code': ClaudeCodeMark,
  anthropic: AnthropicMark,
  copilot: GitHubCopilotMark,
  openai: OpenAIMark,
  gemini: GeminiMark,
} as const;

export type VendorId = keyof typeof VENDOR_ICONS;

/**
 * Brand mark for a harness/agent provider id.
 *
 * `claude-agent` resolves to the Claude Code mark (that provider is the
 * Claude Agent SDK). `copilot` is GitHub's mark. Everything else — including
 * `codex` / `opencode` / `acp`, the three breadth-adapter harnesses that used
 * to fall through to the Copilot mark and read as "GitHub Copilot" in the
 * picker — gets the neutral `GenericProviderMark` instead of another
 * vendor's logo (W48 provider honesty).
 */
export function ProviderBrandIcon({ provider, className }: { provider: string; className?: string }): React.JSX.Element {
  if (provider === 'claude-agent' || provider === 'claude-code' || provider === 'claude') {
    return <ClaudeCodeMark className={className} />;
  }
  if (provider === 'anthropic') return <AnthropicMark className={className} />;
  if (provider === 'copilot') return <GitHubCopilotMark className={className} />;
  if (provider === 'openai') return <OpenAIMark className={className} />;
  if (provider === 'gemini' || provider === 'google') return <GeminiMark className={className} />;
  return <GenericProviderMark className={className} />;
}

/**
 * Underlying model vendor for a model id, independent of which harness serves
 * it — Copilot fronts GPT, Claude *and* Gemini models, so the harness icon
 * alone can't tell you who actually made the model.
 */
export function vendorForModel(modelId: string): VendorId {
  const id = modelId.toLowerCase();
  if (id.includes('claude') || id.includes('sonnet') || id.includes('opus') || id.includes('haiku')) {
    return 'claude-code';
  }
  if (id.includes('gemini')) return 'gemini';
  if (id.includes('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'openai';
  return 'copilot';
}

/** Brand mark for the vendor that actually produced a model. */
export function ModelVendorIcon({ modelId, className }: { modelId: string; className?: string }): React.JSX.Element {
  const Mark = VENDOR_ICONS[vendorForModel(modelId)];
  return <Mark className={className} />;
}
