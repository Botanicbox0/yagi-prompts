/**
 * docs/PLATFORM-2.0.md §20 — the fields an AI creative fills in about themself, validated the same
 * way wherever they arrive (the studio form, the MCP tool, a test). Pure: no database, no env, so
 * the browser editor can share the rules and the tests pin them without a fixture.
 *
 * Every value is the creative's own choice and becomes public only while their profile is public.
 * Empty input always means "not shown" (null or an empty list), never a placeholder.
 */

export const DISPLAY_NAME_MAX = 40;
export const HEADLINE_MAX = 80;
export const CITY_MAX = 40;
export const EMAIL_MAX = 254;
export const MAKER_LINKS_MAX = 6;
export const MAKER_TOOLS_MAX = 8;
export const MAKER_TOOL_MAX = 32;
const URL_MAX = 300;

/** ISO 3166-1 alpha-2, current codes only (no AN/SU/YU-style retired ones). */
export const COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG '
  + 'GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ '
  + 'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR '
  + 'NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ '
  + 'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');
const COUNTRIES = new Set(COUNTRY_CODES);

/** Where a link points, from its host. `website` is anything else on https. */
export const LINK_KINDS = ['instagram', 'tiktok', 'youtube', 'x', 'threads', 'higgsfield', 'behance', 'vimeo', 'linkedin', 'website'] as const;
export type MakerLinkKind = (typeof LINK_KINDS)[number];
export interface MakerLink { kind: MakerLinkKind; url: string }

const HOSTS: Record<Exclude<MakerLinkKind, 'website'>, string[]> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
  threads: ['threads.net', 'threads.com'],
  higgsfield: ['higgsfield.ai'],
  behance: ['behance.net'],
  vimeo: ['vimeo.com'],
  linkedin: ['linkedin.com'],
};

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Trimmed single-line text of 1..max characters; empty is null; anything else is `false`. */
export function lineOf(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  if ([...text].length > max || CONTROL.test(text)) return false;
  return text;
}

export function countryOf(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  if (code === '') return null;
  return COUNTRIES.has(code) ? code : false;
}

export function emailOf(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email === '') return null;
  if (email.length > EMAIL_MAX || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || CONTROL.test(email)) return false;
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`;
}

/** `Seedance 2.5, Midjourney ,  ComfyUI` → three tools, first spelling wins on duplicates. */
export function toolsOf(value: unknown): string[] | false {
  if (value === undefined || value === null) return [];
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : null;
  if (!parts) return false;
  const tools: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tool = lineOf(part, MAKER_TOOL_MAX);
    if (tool === false) return false;
    if (tool === null || seen.has(tool.toLowerCase())) continue;
    seen.add(tool.toLowerCase());
    tools.push(tool);
  }
  return tools.length <= MAKER_TOOLS_MAX ? tools : false;
}

function kindOfHost(host: string): MakerLinkKind {
  const bare = host.replace(/^(www\.|m\.)/, '');
  for (const [kind, hosts] of Object.entries(HOSTS) as Array<[Exclude<MakerLinkKind, 'website'>, string[]]>) {
    if (hosts.some((item) => bare === item || bare.endsWith(`.${item}`))) return kind;
  }
  return 'website';
}

/**
 * One link: an https URL (http is upgraded; a bare `instagram.com/x` gets the scheme). Nothing with
 * credentials, a port or a non-web scheme. The kind comes from the host, so a creative never picks it.
 */
export function linkOf(value: unknown): MakerLink | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  let raw = value.trim();
  if (raw === '') return null;
  if (raw.length > URL_MAX || CONTROL.test(raw) || /\s/.test(raw)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) return false;
  url.hash = '';
  const href = url.toString();
  return href.length <= URL_MAX ? { kind: kindOfHost(url.hostname.toLowerCase()), url: href } : false;
}

export function linksOf(value: unknown): MakerLink[] | false {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return false;
  const links: MakerLink[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const link = linkOf(typeof item === 'object' && item !== null && 'url' in item ? (item as { url: unknown }).url : item);
    if (link === false) return false;
    if (link === null || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links.length <= MAKER_LINKS_MAX ? links : false;
}

/** What the database holds, read back defensively: anything malformed is dropped, never rendered. */
export function storedLinks(raw: unknown): MakerLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const link = linkOf(typeof item === 'object' && item !== null ? (item as { url?: unknown }).url : null);
    return link ? [link] : [];
  }).slice(0, MAKER_LINKS_MAX);
}

/** Path words that are a platform's own pages, not a person (`/p/…`, `/reel/…`, `/watch`, `/in/…`). */
const NOT_A_NAME = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'watch', 'channel', 'c', 'user', 'video', 'videos', 'in', 'company', 'status', 'blogs', 'gallery']);

/** The short label a link shows: `@name` on a social profile, the host on a website. */
export function linkLabel(link: MakerLink): string {
  const url = new URL(link.url);
  const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '');
  if (link.kind !== 'website' && /^@?[\p{L}\p{N}._-]{1,40}$/u.test(segment) && !NOT_A_NAME.has(segment.toLowerCase())) {
    return segment.startsWith('@') ? segment : `@${segment}`;
  }
  return url.hostname.replace(/^www\./, '');
}

/** 🇰🇷 from `KR` — regional indicator symbols, so no image or library is needed. */
export function countryFlag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65)) : '';
}

/** `KR` → 대한민국 / South Korea, in the page's language; the code itself when the runtime has no name. */
export function countryName(code: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
