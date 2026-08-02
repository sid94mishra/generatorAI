// ────────────────────────────────────────────────────────────────
// Settings brand marks — thin re-export of the shared vendor icon set.
//
// The glyphs themselves live in `components/shared/VendorIcons.tsx` so the
// settings surfaces, the model picker and anything else always render the
// same brand marks (notably: `claude-agent` shows the Claude Code mark, not
// the Anthropic corporate wordmark, because that provider is the Claude
// Agent SDK). This module only keeps the historical import path working.
// ────────────────────────────────────────────────────────────────

export {
  GitHubCopilotMark as CopilotMark,
  ClaudeCodeMark as ClaudeMark,
  ClaudeCodeMark,
  AnthropicMark,
  OpenAIMark,
  GeminiMark,
  ProviderBrandIcon,
  ModelVendorIcon,
  vendorForModel,
  VENDOR_ICONS,
  type VendorId,
} from '@/components/shared/VendorIcons.js';
