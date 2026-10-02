// Spike-only: every theme × mode as a Uniwind @variant block (02 §9.9 check 2).
import { writeFileSync } from 'node:fs';
import { THEMES } from '/Users/sidmishra/Desktop/Projects/mobile_redesign/packages/design-tokens/src/themes/index.ts';
import { DESIGN_COLOR_VARS, resolveDesignTokens } from '/Users/sidmishra/Desktop/Projects/mobile_redesign/packages/design-tokens/src/design.ts';

const out = process.argv[2]!;
const block = (name: string, theme: (typeof THEMES)[number], mode: 'dark' | 'light') => {
  const d = resolveDesignTokens(theme, mode, theme.defaultAccent);
  return [`    @variant ${name} {`, ...DESIGN_COLOR_VARS.map(([k, v]) => `      ${v}: ${d[k]};`), '    }'].join('\n');
};
const base = THEMES.find((t) => t.id === 'instrument')!;
const blocks = [block('dark', base, 'dark'), block('light', base, 'light')];
const names: string[] = [];
for (const t of THEMES) for (const m of ['dark', 'light'] as const) {
  names.push(`${t.id}-${m}`);
  blocks.push(block(`${t.id}-${m}`, t, m));
}
writeFileSync(out + '/themes.css', `/* spike: generated */\n@layer theme {\n  :root {\n${blocks.join('\n')}\n  }\n}\n`);
writeFileSync(out + '/themes.json', JSON.stringify(names));
console.log(`${blocks.length} blocks, ${DESIGN_COLOR_VARS.length} vars each`);
