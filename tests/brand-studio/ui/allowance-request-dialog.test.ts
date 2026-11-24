import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shortage notice lives inside the prompt bar's <form>. Its request dialog has a <form> of its own, and a
 * form nested in a form is submitted as the outer one: on 2026-11-24 "요청 전달" pressed 만들기 again and the
 * extra-credit request was never sent (seen on a real screen: no POST to /api/brand-billing/request).
 *
 * There is no browser environment in this suite, so this is a structural guard on the two things the fix
 * rests on. The behaviour itself was checked on a real screen (one POST to the billing request route, no
 * `job.create`, the dialog showing its sent state).
 */
const notice = readFileSync(resolve(process.cwd(), 'components/brand-studio/studio-allowance-notice.tsx'), 'utf8');
const dock = readFileSync(resolve(process.cwd(), 'components/brand-studio/dock.tsx'), 'utf8');
const dialog = readFileSync(resolve(process.cwd(), 'components/brand-billing/billing-request-form.tsx'), 'utf8');

describe('studio shortage notice: the request dialog is not a form inside the prompt bar form', () => {
  it('still holds the premise: the notice is rendered inside the prompt bar form, and the dialog submits a form', () => {
    const open = dock.indexOf('<form');
    const close = dock.indexOf('</form>');
    const at = dock.indexOf('<StudioAllowanceNotice');
    expect(open).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(open);
    expect(at).toBeLessThan(close);
    expect(dialog).toMatch(/<form[^>]*onSubmit=\{handleSubmit\}/);
  });

  it('draws the dialog under <body>', () => {
    expect(notice).toMatch(/createPortal\(/);
    expect(notice).toMatch(/document\.body,/);
    // The dialog is only ever mounted through the portal.
    const first = notice.indexOf('<BillingRequestDialog');
    expect(first).toBeGreaterThan(notice.indexOf('createPortal('));
    expect(notice.indexOf('<BillingRequestDialog', first + 1)).toBe(-1);
  });

  it('keeps the dialog submit from reaching the prompt bar (React events climb out of a portal)', () => {
    expect(notice).toMatch(/onSubmit=\{\(event\) => event\.stopPropagation\(\)\}/);
  });
});
