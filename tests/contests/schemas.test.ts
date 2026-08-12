import { describe, expect, it } from 'vitest';
import {
  ContestFormSchema,
  ENTRY_NOTE_MAX,
  ENTRY_TITLE_MAX,
  EntrySubmissionSchema,
  PlacementSchema,
  URL_MAX,
  parseDateTimeLocal,
  parseHttpUrl,
  platformOf,
  publishBlockers,
  snsDisplayHandle,
  toDateTimeLocal,
} from '@/lib/contests/schemas';

/**
 * PLAN §14.1 — the entry payload and the URL rules that are the whole of it.
 *
 * §14.1 makes films LINKS rather than uploads, so a contest entry has no bytes and almost no
 * surface: the only thing standing between an entrant and the public page is URL validation. These
 * tests are therefore mostly a matrix over URLs, and the cases that matter are the ones that PARSE
 * but must not be accepted.
 */

const valid = {
  title: 'Last train, Yeongdeungpo',
  videoUrl: 'https://www.youtube.com/watch?v=abc',
  snsUrl: 'https://www.instagram.com/hana.films',
  note: 'Shot entirely from the neon-alley prompt.',
  consent: true as const,
};

describe('parseHttpUrl — the gate (§14.1)', () => {
  it('accepts http and https', () => {
    expect(parseHttpUrl('https://vimeo.com/123')?.protocol).toBe('https:');
    expect(parseHttpUrl('http://example.com/a')?.protocol).toBe('http:');
  });

  /** The case the whole function exists for: `javascript:` is a perfectly valid URL. */
  it('refuses javascript: even though it parses', () => {
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
  });

  it('refuses data:, mailto: and ftp:', () => {
    for (const value of ['data:text/html,<b>x', 'mailto:a@b.c', 'ftp://example.com/f']) {
      expect(parseHttpUrl(value), value).toBeNull();
    }
  });

  it('refuses a protocol-relative or bare host', () => {
    for (const value of ['//example.com', 'example.com', '/contests']) {
      expect(parseHttpUrl(value), value).toBeNull();
    }
  });

  it('refuses an empty host', () => {
    expect(parseHttpUrl('https://')).toBeNull();
  });

  it('refuses a URL longer than the column would hold', () => {
    expect(parseHttpUrl(`https://example.com/${'a'.repeat(URL_MAX)}`)).toBeNull();
  });

  it('refuses non-strings and blanks', () => {
    for (const value of [null, undefined, 42, '', '   ']) {
      expect(parseHttpUrl(value), String(value)).toBeNull();
    }
  });
});

describe('platformOf — the chip (§14.1)', () => {
  const cases: Array<[string, string]> = [
    ['https://www.instagram.com/hana', 'instagram'],
    ['https://instagram.com/hana', 'instagram'],
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://m.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.tiktok.com/@hana', 'tiktok'],
    ['https://x.com/hana', 'x'],
    ['https://www.threads.net/@hana', 'threads'],
    ['https://threads.com/@hana', 'threads'],
    ['https://vimeo.com/123', 'vimeo'],
    ['https://hana.example.com/films', 'link'],
    ['https://example.com', 'link'],
  ];

  for (const [url, expected] of cases) {
    it(`maps ${url} → ${expected}`, () => {
      expect(platformOf(url)).toBe(expected);
    });
  }

  /**
   * Interpretation logged for the Director: §14.1's list names "x/twitter" separately. They are one
   * platform with two hostnames, so `twitter.com` resolves to the `x` key — a chip reading TWITTER
   * beside one reading X would suggest the site thinks they are different places.
   */
  it('folds twitter.com into x', () => {
    expect(platformOf('https://twitter.com/hana')).toBe('x');
  });

  it('is `link`, never a throw, for anything that is not a URL', () => {
    expect(platformOf('nonsense')).toBe('link');
    expect(platformOf(null)).toBe('link');
  });

  /** A lookalike host must not inherit the chip. */
  it('does not match a host that merely contains the domain', () => {
    expect(platformOf('https://notinstagram.com/hana')).toBe('link');
    expect(platformOf('https://instagram.com.evil.example/hana')).toBe('link');
  });
});

describe('snsDisplayHandle — the credit, not the tracking URL (§14.2)', () => {
  it('takes the first path segment as a handle', () => {
    expect(snsDisplayHandle('https://www.instagram.com/hana.films/?hl=ko')).toBe('@hana.films');
  });

  it('strips a leading @ rather than doubling it', () => {
    expect(snsDisplayHandle('https://www.tiktok.com/@hana')).toBe('@hana');
  });

  it('falls back to the host when there is no path', () => {
    expect(snsDisplayHandle('https://hana.example.com/')).toBe('hana.example.com');
  });

  it('is null for a non-URL', () => {
    expect(snsDisplayHandle('nope')).toBeNull();
  });
});

describe('EntrySubmissionSchema (§14.1)', () => {
  it('accepts a complete entry', () => {
    expect(EntrySubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it('requires the SNS link — it is the point of the milestone', () => {
    const result = EntrySubmissionSchema.safeParse({ ...valid, snsUrl: '' });
    expect(result.success).toBe(false);
  });

  it('requires the video link', () => {
    expect(EntrySubmissionSchema.safeParse({ ...valid, videoUrl: '' }).success).toBe(false);
  });

  it('refuses a javascript: link in either field', () => {
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, videoUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, snsUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('caps the title at §14.1 length', () => {
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, title: 'x'.repeat(ENTRY_TITLE_MAX) }).success,
    ).toBe(true);
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, title: 'x'.repeat(ENTRY_TITLE_MAX + 1) }).success,
    ).toBe(false);
  });

  it('caps the note at 300 and allows it to be absent', () => {
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, note: 'x'.repeat(ENTRY_NOTE_MAX) }).success,
    ).toBe(true);
    expect(
      EntrySubmissionSchema.safeParse({ ...valid, note: 'x'.repeat(ENTRY_NOTE_MAX + 1) }).success,
    ).toBe(false);
    expect(EntrySubmissionSchema.safeParse({ ...valid, note: null }).success).toBe(true);
  });

  /** An unchecked box posts nothing; "absent" must fail the same way "false" does. */
  it('refuses a missing consent as firmly as a false one', () => {
    expect(EntrySubmissionSchema.safeParse({ ...valid, consent: undefined }).success).toBe(false);
    expect(EntrySubmissionSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });
});

describe('parseDateTimeLocal — UTC by declaration (§14.2 admin)', () => {
  it('reads a datetime-local value as UTC', () => {
    expect(parseDateTimeLocal('2026-09-01T09:30')).toBe('2026-09-01T09:30:00.000Z');
  });

  it('accepts seconds when a browser sends them', () => {
    expect(parseDateTimeLocal('2026-09-01T09:30:45')).toBe('2026-09-01T09:30:45.000Z');
  });

  it('accepts an instant it is handed back (a fixture, a DB round trip)', () => {
    expect(parseDateTimeLocal('2026-09-01T09:30:00.000Z')).toBe('2026-09-01T09:30:00.000Z');
  });

  it('refuses a date that does not exist rather than rolling it into March', () => {
    expect(parseDateTimeLocal('2026-02-31T09:00')).toBeNull();
  });

  it('is null for blanks and nonsense', () => {
    for (const value of ['', '   ', 'tomorrow', null, undefined, 5]) {
      expect(parseDateTimeLocal(value), String(value)).toBeNull();
    }
  });

  it('round-trips through the form value', () => {
    const iso = '2026-09-01T09:30:00.000Z';
    expect(parseDateTimeLocal(toDateTimeLocal(iso))).toBe(iso);
    expect(toDateTimeLocal(null)).toBe('');
    expect(toDateTimeLocal('not-a-date')).toBe('');
  });
});

describe('ContestFormSchema (§14.2 admin)', () => {
  const form = {
    slug: 'launch-film-contest',
    title: { en: 'Launch film', ko: '런칭 단편' },
    summary: { en: 'Make a film.', ko: '단편을 만들어 주세요.' },
    prize: { en: '$3,000', ko: '$3,000' },
    rules: null,
    brandName: 'YAGI WORKSHOP',
    brandUrl: 'https://yagiworkshop.xyz',
    startsAt: '2026-09-01T00:00',
    deadlineAt: '2026-09-30T00:00',
  };

  it('accepts a complete contest', () => {
    const result = ContestFormSchema.safeParse(form);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startsAt).toBe('2026-09-01T00:00:00.000Z');
      expect(result.data.deadlineAt).toBe('2026-09-30T00:00:00.000Z');
    }
  });

  it('refuses a deadline at or before the start', () => {
    expect(ContestFormSchema.safeParse({ ...form, deadlineAt: '2026-09-01T00:00' }).success).toBe(
      false,
    );
    expect(ContestFormSchema.safeParse({ ...form, deadlineAt: '2026-08-01T00:00' }).success).toBe(
      false,
    );
  });

  it('allows a draft with no dates at all', () => {
    expect(
      ContestFormSchema.safeParse({ ...form, startsAt: null, deadlineAt: null }).success,
    ).toBe(true);
  });

  it('refuses a slug that is not a slug', () => {
    for (const slug of ['Launch Film', 'launch_film', '-launch', 'ab']) {
      expect(ContestFormSchema.safeParse({ ...form, slug }).success, slug).toBe(false);
    }
  });

  it('refuses a brand link that is not http(s)', () => {
    expect(ContestFormSchema.safeParse({ ...form, brandUrl: 'javascript:x' }).success).toBe(false);
    expect(ContestFormSchema.safeParse({ ...form, brandUrl: null }).success).toBe(true);
  });
});

describe('publishBlockers — the gate that names what is missing (§14.2)', () => {
  const poster = {
    poster: { staging_key: 'k.png', sha256: 'a'.repeat(64), mime: 'image/png' },
  };
  const ready = {
    title: { en: 'A', ko: 'ㄱ' },
    summary: { en: 'B', ko: 'ㄴ' },
    prize: { en: '$1', ko: '$1' },
    rules: null,
    media: poster,
    startsAt: '2026-09-01T00:00:00.000Z',
    deadlineAt: '2026-09-30T00:00:00.000Z',
  };

  it('is empty when everything a published contest needs is there', () => {
    expect(publishBlockers(ready)).toEqual([]);
  });

  it('names a missing Korean prize line', () => {
    expect(publishBlockers({ ...ready, prize: { en: '$1', ko: '' } })).toEqual(['prize (en + ko)']);
  });

  it('names a half-written rules block, and lets an absent one pass', () => {
    expect(publishBlockers({ ...ready, rules: { en: '## Brief', ko: '' } })).toEqual([
      'rules (en + ko)',
    ]);
    expect(publishBlockers({ ...ready, rules: null })).toEqual([]);
  });

  it('names missing dates and a backwards one', () => {
    expect(publishBlockers({ ...ready, startsAt: null })).toEqual(['start date']);
    expect(publishBlockers({ ...ready, deadlineAt: '2026-08-01T00:00:00.000Z' })).toEqual([
      'a deadline after the start',
    ]);
  });

  it('names a missing poster — §14.2 makes the card poster-led', () => {
    expect(publishBlockers({ ...ready, media: null })).toEqual(['poster image']);
  });

  it('names everything at once, so publishing is not a guessing game', () => {
    expect(
      publishBlockers({
        title: { en: '', ko: '' },
        summary: { en: '', ko: '' },
        prize: { en: '', ko: '' },
        rules: null,
        media: null,
        startsAt: null,
        deadlineAt: null,
      }),
    ).toEqual([
      'title (en + ko)',
      'summary (en + ko)',
      'prize (en + ko)',
      'start date',
      'deadline',
      'poster image',
    ]);
  });
});

describe('PlacementSchema (§14.1)', () => {
  const id = '9d000000-0000-4000-8000-000000000001';

  it('accepts 1, 2, 3 and null', () => {
    for (const placement of [1, 2, 3, null]) {
      expect(PlacementSchema.safeParse({ id, placement }).success, String(placement)).toBe(true);
    }
  });

  it('refuses a fourth place', () => {
    for (const placement of [0, 4, -1, '1']) {
      expect(PlacementSchema.safeParse({ id, placement }).success, String(placement)).toBe(false);
    }
  });
});
