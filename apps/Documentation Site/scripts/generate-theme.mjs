import fs from 'node:fs';
import path from 'node:path';
import {site, loadSource} from './source-loader.mjs';
const tokens = loadSource('packages/design-tokens/src/index.ts');
const {THEMES, ACCENT_IDS, ACCENT_LABELS, DEFAULT_THEME, resolveAppearanceTokens, resolveAccentTokens} = tokens;
const out = path.join(site, 'src/theme-data'); fs.mkdirSync(out, {recursive: true});
const metadata = {defaultTheme: DEFAULT_THEME, themes: THEMES.filter(t=>!t.hidden).map(t=>({id:t.id,label:t.label,group:t.group,description:t.description})), accents: ACCENT_IDS.map(id=>({id,label:ACCENT_LABELS[id]}))};
fs.writeFileSync(path.join(out,'palettes.json'),JSON.stringify(metadata,null,2)+'\n');
let css='/* Generated from packages/design-tokens. Run npm run theme:generate. */\n';
const checks=[];
for (const theme of THEMES) for (const mode of ['light','dark']) {
  const t=resolveAppearanceTokens(theme,mode);
  const selector=`html[data-theme='${mode}'][data-palette='${theme.id}']`;
  const fallback=theme.id===DEFAULT_THEME ? `html[data-theme='${mode}']:not([data-palette]),` : '';
  const vars={background:t.background,foreground:t.foreground,card:t.card,popover:t.popover,subtle:t.subtle,emphasis:t.emphasis,muted:t.mutedForeground,border:t.border,'border-muted':t.borderMuted,success:t.success,warning:t.warning,danger:t.danger,info:t.info,sidebar:t.sidebar,'code-keyword':theme[mode].hues.purple,'code-string':theme[mode].hues.green,'code-number':theme[mode].hues.orange,'font-sans':theme.fonts.sans,'font-mono':theme.fonts.mono,radius:`${theme.radius.DEFAULT}px`,'radius-lg':`${theme.radius.lg}px`,'radius-xl':`${theme.radius.xl}px`};
  css+=`${fallback}${selector}{${Object.entries(vars).map(([k,v])=>`--app-${k}:${v};`).join('')}}\n`;
  for(const id of ACCENT_IDS){
    const a=resolveAccentTokens(theme,id,mode);
    const sel=`${selector}[data-accent='${id}']`;
    const defaultSel=id===theme.defaultAccent?`${selector}:not([data-accent]),${theme.id===DEFAULT_THEME?`html[data-theme='${mode}']:not([data-palette]),`:''}`:'';
    css+=`${defaultSel}${sel}{--app-primary:${a.primary};--app-primary-fill:${a.primaryEmphasis};--app-on-primary:${t.primaryForeground};--app-accent:${a.accent};}\n`;
    checks.push({theme:theme.id,mode,accent:id,background:t.background,foreground:t.foreground,primary:a.primary,fill:a.primaryEmphasis});
  }
}
fs.writeFileSync(path.join(out,'palettes.css'),css);
fs.writeFileSync(path.join(site,'audit/theme-tokens.json'),JSON.stringify(checks,null,2)+'\n');
console.log(`Generated ${THEMES.length} application palettes, both modes, ${ACCENT_IDS.length} accents.`);
