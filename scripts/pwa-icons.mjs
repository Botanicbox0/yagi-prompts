// `npm run pwa:icons` — the installed app's icons, generated from the one app icon (app/icon.png,
// served at /icon.png). docs/PLATFORM-2.0.md §5.2, 2026-10-22. The outputs are committed; run this
// again only when app/icon.png changes.
//
//   public/icons/icon-{192,512}.png      purpose "any": the icon as it is
//   public/icons/maskable-{192,512}.png  purpose "maskable": the mark shrunk into the 80% safe circle
//                                        on a full-bleed square of the icon's own background, so
//                                        Android can crop it to a circle, squircle or teardrop
//   public/icons/badge-96.png            the notification badge: Android draws only its alpha, so
//                                        the mark becomes white on transparent
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'app', 'icon.png');
const out = join(root, 'public', 'icons');

/** The art must sit inside a circle of radius 40%; aim a little inside it for anti-aliased edges. */
const SAFE_RADIUS = 0.36;

const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const background = at(0, 0);
const differs = (p) => Math.abs(p[0] - background[0]) + Math.abs(p[1] - background[1]) + Math.abs(p[2] - background[2]) > 24;

// How far from the centre the mark reaches, as a share of the icon's width.
let reach = 0;
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    if (differs(at(x, y))) reach = Math.max(reach, Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2));
  }
}
const scale = Math.min(1, (SAFE_RADIUS * info.width) / reach);
const [r, g, b] = background;

await mkdir(out, { recursive: true });

for (const size of [192, 512]) {
  await sharp(source).removeAlpha().resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(join(out, `icon-${size}.png`));

  const inner = Math.round(size * scale);
  const art = await sharp(source).removeAlpha().resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } })
    .composite([{ input: art, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toFile(join(out, `maskable-${size}.png`));
}

// Badge: luminance as alpha (white mark → opaque, black background → transparent).
const badgeSize = 96;
const alpha = await sharp(source).removeAlpha().greyscale().resize(badgeSize, badgeSize, { kernel: 'lanczos3' }).raw().toBuffer();
const rgba = Buffer.alloc(badgeSize * badgeSize * 4);
for (let i = 0; i < badgeSize * badgeSize; i += 1) {
  rgba[i * 4] = 255;
  rgba[i * 4 + 1] = 255;
  rgba[i * 4 + 2] = 255;
  rgba[i * 4 + 3] = Math.abs(alpha[i] - Math.round((r + g + b) / 3));
}
await sharp(rgba, { raw: { width: badgeSize, height: badgeSize, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(out, 'badge-96.png'));

console.log(`pwa icons → public/icons (mark reach ${(reach / info.width).toFixed(3)} of width, maskable scale ${scale.toFixed(3)})`);
