// App icon appearance variants (M10-05, 06 §8.8, MD-196), drawn from the mark's geometry so they stay exact: the app mark
// is a white ring (outer radius 266, inner 114 on the 1024 artwork, centred at 513) on the blue tile of assets/icon.png.
//
//   assets/icon-ios-dark.png            iOS dark appearance: the ring in the tile blue on a transparent canvas (iOS
//                                       draws its dark backdrop), sized to the full icon like the light tile's mark.
//   assets/icon-ios-tinted.png          iOS tinted appearance: the ring in white on a transparent canvas (iOS tints by
//                                       luminance; the "clear" look is derived by the system from these images).
//   assets/icon-android-monochrome.png  Android 13+ themed icon: the ring in white inside the 66 dp safe zone of the
//                                       108 dp adaptive canvas (the launcher recolours it).
//
// The light icon (assets/icon-ios.png) and the Android adaptive foreground (assets/icon.png) are unchanged artwork.
// Re-run after changing the mark: node apps/mobile/scripts/gen-app-icons.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

const SIZE = 1024;
const TILE_BLUE = '#3584f0';
/** Ring radii on the 1024 artwork, relative to the 902 px tile (62…964). */
const OUTER = 266 / 902;
const INNER = 114 / 902;

function ring({ outer, fill, canvas = SIZE }) {
  const inner = (outer * INNER) / OUTER;
  const c = canvas / 2;
  // An annulus as one even-odd path, so the hole stays transparent.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <path fill="${fill}" fill-rule="evenodd" d="M ${c - outer} ${c} a ${outer} ${outer} 0 1 0 ${outer * 2} 0 a ${outer} ${outer} 0 1 0 ${-outer * 2} 0 Z M ${c - inner} ${c} a ${inner} ${inner} 0 1 0 ${inner * 2} 0 a ${inner} ${inner} 0 1 0 ${-inner * 2} 0 Z"/>
</svg>`);
}

const outputs = [
  // Full-bleed icons: the ring at the tile-relative size it has inside the light icon's (full-canvas) mask.
  ['icon-ios-dark.png', ring({ outer: OUTER * SIZE, fill: TILE_BLUE })],
  ['icon-ios-tinted.png', ring({ outer: OUTER * SIZE, fill: '#ffffff' })],
  // Adaptive canvas 108 dp: the safe zone is the central 66 dp circle; the ring's outer edge stays at 80 % of it.
  ['icon-android-monochrome.png', ring({ outer: ((66 / 108) * SIZE * 0.8) / 2, fill: '#ffffff' })],
];

for (const [name, svg] of outputs) {
  await sharp(svg).png().toFile(path.join(assets, name));
  console.log(`assets/${name}`);
}
