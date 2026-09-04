// Writes the static monogram SVGs from the same geometry the video animates.
//   npm run brand   ->  brand/yagi-mark.svg (cream, for dark) + brand/yagi-mark-black.svg (for light)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREAM, markSvg } from '../src/mark-geometry.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'yagi-mark.svg'), markSvg(CREAM) + '\n');
writeFileSync(join(out, 'yagi-mark-black.svg'), markSvg('#111111') + '\n');
console.log('wrote', out);
