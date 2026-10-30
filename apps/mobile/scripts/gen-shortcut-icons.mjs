// Android app-shortcut icons (mobile 06 §7.6, M9-07): the Material Symbols glyph of each quick action, centred on a
// 108 dp adaptive-icon foreground (432 px = xxxhdpi) inside the 66 dp safe zone, in the icon artwork colour. The
// expo-quick-actions config plugin turns each PNG into an adaptive mipmap (`androidIcons` in app.config.ts). iOS uses
// SF Symbols and needs no files. Re-run after changing a glyph: node scripts/gen-shortcut-icons.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets/shortcuts');
const symbols = path.dirname(require.resolve('@material-symbols/svg-400/package.json'));

/** Shortcut → Material Symbols name (06 §7.6). */
export const SHORTCUT_GLYPHS = { 'new-chat': 'edit_square', home: 'home', workflows: 'play_arrow', search: 'search' };
const SIZE = 432;
const GLYPH = 176; // ≈ 44 dp of the 108 dp canvas
const INK = '#0d1117';

mkdirSync(out, { recursive: true });
for (const [id, glyph] of Object.entries(SHORTCUT_GLYPHS)) {
  const svg = readFileSync(path.join(symbols, 'outlined', `${glyph}.svg`), 'utf8').replace('<svg ', `<svg fill="${INK}" `);
  const icon = await sharp(Buffer.from(svg)).resize(GLYPH, GLYPH).png().toBuffer();
  const offset = Math.round((SIZE - GLYPH) / 2);
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: icon, left: offset, top: offset }])
    .png()
    .toFile(path.join(out, `${id}.png`));
  console.log(`assets/shortcuts/${id}.png ← ${glyph}`);
}
