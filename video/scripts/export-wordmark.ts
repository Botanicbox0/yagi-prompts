// Writes the static wordmark SVGs from the same geometry the video animates.
//   npm run brand -> brand/yagi-workshop.svg (cream, for dark) + brand/yagi-workshop-black.svg
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREAM, wordmarkSvg } from '../src/wordmark.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'yagi-workshop.svg'), wordmarkSvg('YAGI WORKSHOP', CREAM) + '\n');
writeFileSync(join(out, 'yagi-workshop-black.svg'), wordmarkSvg('YAGI WORKSHOP', '#111111') + '\n');
console.log('wrote', out);
