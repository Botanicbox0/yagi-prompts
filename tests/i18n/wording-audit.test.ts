import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeSources, csv, flattenStrings, routeFromFile } from '../../scripts/wording/inventory';
import { triage, validateReviews, type Review } from '../../scripts/wording/audit';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('wording inventory evidence', () => {
  it('follows mapped Dictionary props, local aliases and dynamic status sets without inventing unused references', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'twings-wording-'));
    roots.push(root);
    const write = (file: string, body: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), body); };
    write('messages/en.ts', `export const en = { campaigns: { title: 'Campaigns', unused: 'Old', status: { paid: 'Paid', selected: 'Selected' } }, nav: { home: 'Home' } } as const; type W<T> = { [K in keyof T]: T[K] extends string ? string : W<T[K]> }; export type Dictionary = W<typeof en>;`);
    write('components/card.tsx', `import type { Dictionary } from '../messages/en'; export function Card({ dict, state }: { dict: Dictionary; state: 'paid' | 'selected' }) { const c = dict.campaigns; return <p>{c.title} {c.status[state]}</p>; }`);
    write('app/(app)/campaigns/mine/page.tsx', `import { Card } from '../../../../components/card'; export default Card;`);
    write('app/(app)/layout.tsx', `import type { Dictionary } from '../../messages/en'; export const Header = (dict: Dictionary) => dict.nav.home;`);
    write('app/page.tsx', `export default function Page() { return <p>Home</p>; }`);
    const result = analyzeSources(root);
    expect(result.uses.get('campaigns.title')?.[0]?.file).toBe('components/card.tsx');
    expect(result.uses.has('campaigns.unused')).toBe(false);
    expect(result.uses.get('campaigns.status.paid')?.[0]?.kind).toBe('dynamic-set');
    expect(result.uses.get('campaigns.status.selected')?.[0]?.kind).toBe('dynamic-set');
    expect(result.routesByFile.get('components/card.tsx')).toEqual(['/campaigns/mine']);
    expect(result.routesByFile.get('app/(app)/layout.tsx')).toEqual(['/campaigns/mine']);
    expect(result.routeFiles).toContainEqual({ file: 'app/page.tsx', route: '/' });
  });

  it('preserves CSV punctuation and line breaks while neutralizing formula cells', () => {
    expect(csv(['key', 'text'], [['a', '한 줄, "두 줄"\n다음'], ['b', '=HYPERLINK("x")']])).toBe('\uFEFF"key","text"\n"a","한 줄, ""두 줄""\n다음"\n"b","\'=HYPERLINK(""x"")"\n');
    expect(flattenStrings({ a: { b: '한글' } }).get('a.b')).toBe('한글');
    expect(() => flattenStrings({ a: 42 })).toThrow('Non-string');
    expect(routeFromFile('app/(marketing)/[locale]/campaigns/[slug]/page.tsx')).toBe('/[locale]/campaigns/[slug]');
  });

  it('records a narrow dictionary object handed to an independently typed JSX component', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'twings-wording-'));
    roots.push(root);
    mkdirSync(path.join(root, 'messages'), { recursive: true });
    mkdirSync(path.join(root, 'app/example'), { recursive: true });
    writeFileSync(path.join(root, 'messages/en.ts'), `export const en = { campaigns: { brands: { title: 'Ask us', consent: 'I agree' }, unused: 'Old' } } as const;`);
    writeFileSync(path.join(root, 'app/example/page.tsx'), `import { en } from '../../messages/en'; const Form = (props: {labels: {title: string; consent: string}}) => <p>{props.labels.title}</p>; export default function Page() { return <Form labels={en.campaigns.brands} />; }`);
    const result = analyzeSources(root);
    expect(result.uses.get('campaigns.brands.consent')?.[0]?.kind).toBe('object-transfer');
    expect(result.uses.has('campaigns.unused')).toBe(false);
  });

  it('rejects stale reviews and changed runtime placeholders before generating artifacts', () => {
    const ko = new Map([['campaigns.hold', '{days}일 후']]);
    const en = new Map([['campaigns.hold', 'After {days} days']]);
    const review: Review = {
      source_ko: '{days}일 후', source_en: 'After {days} days',
      proposed_ko: '{days}일이 지나면', proposed_en: 'Once {days} days have passed',
      ko: { clarity: 2, specificity: 3, naturalness: 3 }, en: { clarity: 3, specificity: 3, naturalness: 3 },
      reason: 'Clarify the condition', evidence: 'State transition', topic: 'payout', decision: 'candidate',
    };
    expect(() => validateReviews({ 'campaigns.hold': review }, ko, en)).not.toThrow();
    expect(() => validateReviews({ 'campaigns.hold': { ...review, source_ko: 'Old wording' } }, ko, en)).toThrow('Stale review source');
    expect(() => validateReviews({ 'campaigns.hold': { ...review, proposed_en: 'After a week' } }, ko, en)).toThrow('Changed placeholders');
    expect(() => validateReviews({ 'campaigns.unknown': review }, ko, en)).toThrow('Unknown review key');
    expect(() => validateReviews({ 'campaigns.hold': { ...review, en: { ...review.en, clarity: 6 } } }, ko, en)).toThrow('Invalid score');
    expect(triage('nav.home', 'Home', 'en').scores).toEqual({ clarity: 3, specificity: 3, naturalness: 3 });
    expect(triage('campaigns.intro', '7일 후 바로 지급', 'ko').flags).toContain('timing-promise-review');
  });
});
