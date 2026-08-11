import { isEventType, type EventType } from './track';

/**
 * The `/api/events` request contract, as a pure function so it is tested rather than trusted.
 *
 * Only two client-supplied moments exist (§ M3 brief): `hit_lock` (a page rendered ≥1 locked block)
 * and `hire_click` (the footer B2B CTA). Everything else is recorded server-side where the data
 * already is.
 *
 * What a client may say is therefore deliberately tiny:
 *   · `type`    — must be one of the five, and one of the two the beacon is allowed to send;
 *   · `slug`    — resolved SERVER-side to a `playbook_id`, so a caller cannot inject an id;
 *   · `surface` — a closed vocabulary, for telling the detail lock apart from the footer.
 *
 * No user id: the route takes that from the server-verified session and nowhere else. That is the
 * whole of "no PII beyond the session user id" — there is no field in which any could arrive.
 */

/** Types a browser is allowed to report. The other three are server-observed facts. */
export const BEACON_TYPES = ['hit_lock', 'hire_click'] as const;
export type BeaconType = (typeof BEACON_TYPES)[number];

export const BEACON_SURFACES = ['detail', 'footer', 'landing', 'pricing', 'library'] as const;
export type BeaconSurface = (typeof BEACON_SURFACES)[number];

export type ParsedBeacon =
  | { ok: true; type: BeaconType; slug: string | null; surface: BeaconSurface | null }
  | { ok: false; reason: 'bad_body' | 'bad_type' };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isBeaconType(value: unknown): value is BeaconType {
  return typeof value === 'string' && (BEACON_TYPES as readonly string[]).includes(value);
}

export function parseBeacon(body: unknown): ParsedBeacon {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'bad_body' };
  const input = body as { type?: unknown; slug?: unknown; surface?: unknown };

  // Two gates on purpose: `isEventType` keeps the whitelist honest against the DB CHECK, and
  // `isBeaconType` narrows it further to what a browser may claim. A valid-but-server-only type
  // (`start_checkout`, say) is rejected exactly like an invented one.
  if (!isEventType(input.type) || !isBeaconType(input.type)) {
    return { ok: false, reason: 'bad_type' };
  }

  const slug =
    typeof input.slug === 'string' && input.slug.length <= 120 && SLUG.test(input.slug)
      ? input.slug
      : null;
  const surface =
    typeof input.surface === 'string' &&
    (BEACON_SURFACES as readonly string[]).includes(input.surface)
      ? (input.surface as BeaconSurface)
      : null;

  return { ok: true, type: input.type, slug, surface };
}

/** Narrowing helper for callers that hold an `EventType` and want to know if a client may send it. */
export function isBeaconEventType(type: EventType): type is BeaconType {
  return (BEACON_TYPES as readonly string[]).includes(type);
}
