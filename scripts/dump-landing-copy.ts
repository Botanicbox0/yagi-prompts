import { writeFile } from 'node:fs/promises';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import { csv, flattenStrings } from './wording/inventory';

/** Review the new public surface side by side; no account, catalogue or environment data. */
const scope = (key: string) => key.startsWith('yagi.') || key.startsWith('creatorJourney.');
const korean = flattenStrings(ko);
const english = [...flattenStrings(en)].filter(([key]) => scope(key));
const rows = english.map(([key, value]) => [
  key, korean.get(key) ?? '', value, key.startsWith('yagi.') ? '/yagi/[locale]' : '/[locale]',
]);
const path = 'docs/reviews/YAGI-TWINGS-COPY-20261006.csv';
await writeFile(path, csv(['key', 'ko', 'en', 'location'], rows), 'utf8');
console.log(`Wrote ${english.length} public copy entries to ${path}`);
