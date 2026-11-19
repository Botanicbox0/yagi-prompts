import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { engineLabel, resolveEngine } from '@/lib/images/engines';

/** The admin template form's engine hint names what an empty engine really resolves to (lib/images/engines.ts). */
describe('template engine hint', () => {
  it.each(['ko', 'en'] as const)('%s: names the engines an empty value resolves to', (locale) => {
    const hint = getDictionary(locale).admin.templateEngineHint.toLowerCase();
    expect(hint).toContain(engineLabel(resolveEngine(null, 'image')).toLowerCase());
    expect(hint).toContain(engineLabel(resolveEngine(null, 'video')).toLowerCase());
  });
});
