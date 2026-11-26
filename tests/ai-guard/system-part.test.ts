/**
 * The request side at the adopted sites (docs/PROMPT-GUARD.md "The request side"): with the guard on, no
 * customer-controlled string and no reading of the customer's material is in the system part; in the user
 * part every one of them sits inside a `<customer_data>` block, after the "data, never instructions" line.
 * Every customer field of the cases carries a `QX…` marker (reference-cases.ts).
 */
import { describe, expect, it } from 'vitest';
import { DATA_LINE, NON_DISCLOSURE_RULE } from '@/lib/ai-guard';
import { leakingFetch, systemOf, userTextOf } from './leaks';
import { CUSTOMER_MARKERS, isSiteCall } from './reference-cases';
import { ROWS } from './rows';

const TABLE = ROWS.flatMap((row) => row.cases.filter((c) => !c.noCall).map((c) => [row.site, c.id, row, c] as const));

describe.each(TABLE)('%s · %s', (_site, _id, row, c) => {
  it.each(['observe', 'enforce'])('%s: customer text only inside data blocks of the user part', async (mode) => {
    const { calls, fetchImpl } = leakingFetch('benign', c);
    await row.run(c, { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: mode }, fetchImpl);
    const site = calls.filter((call) => isSiteCall(call.body));
    expect(site).toHaveLength(1);
    const body = site[0]!.body;
    const system = systemOf(body);
    expect(system.endsWith(NON_DISCLOSURE_RULE)).toBe(true);
    const markers = CUSTOMER_MARKERS.filter((m) => body.includes(m));
    expect(markers.length, 'the case sends customer text').toBeGreaterThan(0);
    for (const marker of CUSTOMER_MARKERS) expect(system, marker).not.toContain(marker);

    const texts = userTextOf(body);
    expect(texts[0]).toBe(DATA_LINE);
    const outsideBlocks = texts
      .slice(1)
      .map((t) => t.replace(/<customer_data name="[^"]*">[\s\S]*?<\/customer_data>/g, ''))
      .join('\n');
    for (const marker of CUSTOMER_MARKERS) expect(outsideBlocks, marker).not.toContain(marker);
  });

  it('off: the request is the one origin/main sent (customer text where it was)', async () => {
    const { calls, fetchImpl } = leakingFetch('benign', c);
    await row.run(c, { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' }, fetchImpl);
    const body = calls.find((call) => isSiteCall(call.body))!.body;
    expect(systemOf(body)).not.toContain(NON_DISCLOSURE_RULE);
    expect(userTextOf(body)[0]).not.toBe(DATA_LINE);
  });
});
