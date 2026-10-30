// ProviderLogo contract (D-132): an agent provider's brand mark from the one registry (`PROVIDER_LOGOS`).
export type ProviderLogoSize = 16 | 20 | 24 | 28;

export interface ProviderLogoProps {
  /** Provider id (`claude-agent`, `codex`, `copilot`, `opencode`, `acp`, `faux` …); unknown → the neutral mark. */
  provider: string;
  /** Default 20 (the ListRow glyph on iOS). */
  size?: ProviderLogoSize;
  /** `color` (default): the brand colour where the brand has one, else `fg`. `mono`: always `fg`. */
  variant?: 'color' | 'mono';
  /** Present → an image with this name (`true` = the brand's name); absent → decorative. */
  label?: string | true;
  testID?: string;
}
