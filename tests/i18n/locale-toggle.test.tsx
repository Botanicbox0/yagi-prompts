import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ pending: false }));
vi.mock('react-dom', async original => ({
  ...(await original<object>()),
  useFormStatus: () => ({ pending: state.pending }),
}));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
import { LocaleToggle } from '@/components/locale-toggle';

beforeEach(() => { state.pending = false; });

describe('locale toggle interaction', () => {
  it('gives the language choices usable touch targets and prevents resubmitting the current locale', () => {
    const html = renderToStaticMarkup(<LocaleToggle current="ko" rest="/video" />);
    const buttons = html.match(/<button[^>]*>/g)!;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('min-h-10');
    expect(buttons[0]).not.toContain('disabled=""');
    expect(buttons[1]).toContain('disabled=""');
    expect(html).toContain('name="next" value="/en/video"');
  });

  it('shows busy state and blocks duplicate submissions while changing languages', () => {
    state.pending = true;
    const html = renderToStaticMarkup(<LocaleToggle current="en" rest="/pricing" />);
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('animate-spin');
    expect(html).toContain('>KO<');
  });

  it('preserves query parameters on unprefixed app routes', () => {
    const html = renderToStaticMarkup(<LocaleToggle current="en" rest="/identity/verify?next=%2Fko%2Ft%2Ftpl%23make" prefixed={false} />);
    expect(html.match(/name="next" value="\/identity\/verify\?next=%2Fko%2Ft%2Ftpl%23make"/g)).toHaveLength(2);
  });
});
