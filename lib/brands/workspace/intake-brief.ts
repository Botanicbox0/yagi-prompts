import { z } from 'zod';

/**
 * Structured 3-step project brief intake (묶음 E, docs/BRAND-PROJECTS-E.md §4).
 *
 * Stored in `brand_projects.intake_brief` (migration 0085) without internal compiler tags in
 * `brand_projects.objective`. Shared between the client wizard (`project-intake-wizard.tsx`),
 * `BrandProjectSchema` / `service.ts`, the project room's `파일 > 기획서` view, and `/admin`.
 */

export const INTAKE_TRACK_IDS = ['template_build', 'creator_campaign', 'studio_film', 'other'] as const;
export type IntakeTrackId = (typeof INTAKE_TRACK_IDS)[number];

/** Validates an incoming `?track=` param against the tracks this viewer may pick. */
export function parseAllowedIntakeTrack(
  raw: string | string[] | undefined,
  allowTemplate: boolean,
): IntakeTrackId | null {
  if (typeof raw !== 'string') return null;
  if (raw === 'template_build') return allowTemplate ? 'template_build' : null;
  if (raw === 'creator_campaign' || raw === 'studio_film' || raw === 'other') return raw;
  return null;
}

/**
 * Configurable budget bands (founder question Q6 pending; kept in one table so adjusting ranges
 * updates validation, auto-fill, wizard options and admin summaries together).
 */
export const INTAKE_BUDGET_BANDS = [
  'under_300',
  '300_500',
  '500_1000',
  '1000_3000',
  'over_3000',
  'undecided',
] as const;
export type IntakeBudgetBand = (typeof INTAKE_BUDGET_BANDS)[number];

export const INTAKE_ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const;
export type IntakeAspectRatio = (typeof INTAKE_ASPECT_RATIOS)[number];

export const INTAKE_CHANNELS = [
  'instagram_reels',
  'tiktok',
  'youtube_shorts',
  'youtube',
  'owned_web',
  'paid_ads',
] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

export const INTAKE_CONTACT_CHANNELS = ['email', 'phone', 'messenger'] as const;
export type IntakeContactChannel = (typeof INTAKE_CONTACT_CHANNELS)[number];

const cleanText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  });

export const IntakeBriefSchema = z
  .object({
    version: z.literal(1).default(1),
    track: z.enum(INTAKE_TRACK_IDS),
    summary: cleanText(3, 500),
    briefText: cleanText(0, 8000).default(''),
    briefFileNames: z.array(cleanText(1, 160)).max(10).default([]),
    briefAttachmentIds: z.array(z.string().uuid()).max(10).default([]),
    studioAssetIds: z.array(z.string().uuid()).max(20).default([]),
    deliverables: z
      .object({
        kind: cleanText(0, 120).default(''),
        duration: cleanText(0, 60).default(''),
        aspectRatios: z
          .array(z.enum(INTAKE_ASPECT_RATIOS))
          .max(4)
          .transform((v) => [...new Set(v)])
          .default([]),
        quantity: z.number().int().min(1).max(500).nullable().default(null),
        channels: z
          .array(z.enum(INTAKE_CHANNELS))
          .max(6)
          .transform((v) => [...new Set(v)])
          .default([]),
      })
      .default({ kind: '', duration: '', aspectRatios: [], quantity: null, channels: [] }),
    schedule: z
      .object({
        startsOn: isoDay.nullable().default(null),
        dueOn: isoDay.nullable().default(null),
      })
      .default({ startsOn: null, dueOn: null }),
    budgetBand: z.enum(INTAKE_BUDGET_BANDS).default('undecided'),
    contact: z
      .object({
        name: cleanText(1, 80),
        channel: z.enum(INTAKE_CONTACT_CHANNELS).default('email'),
        value: cleanText(1, 160),
        approver: cleanText(0, 120).default(''),
      }),
  })
  .refine((v) => !v.schedule.startsOn || !v.schedule.dueOn || v.schedule.dueOn >= v.schedule.startsOn, {
    path: ['schedule', 'dueOn'],
    message: 'Due date must follow start date',
  });

export type IntakeBrief = z.output<typeof IntakeBriefSchema>;

/** Midpoint/floor KRW hint for legacy numeric `budget_krw` sorting; `null` when undecided. */
export function budgetKrwFromIntakeBand(band: IntakeBudgetBand): number | null {
  switch (band) {
    case 'under_300':
      return 2_000_000;
    case '300_500':
      return 4_000_000;
    case '500_1000':
      return 7_500_000;
    case '1000_3000':
      return 20_000_000;
    case 'over_3000':
      return 30_000_000;
    case 'undecided':
      return null;
  }
}

export function productionModeForIntakeTrack(track: IntakeTrackId): 'creator' | 'studio' {
  return track === 'creator_campaign' ? 'creator' : 'studio';
}

/** Clean customer-safe `objective` column derived from an `IntakeBrief` (zero internal tags). */
export function objectiveFromIntakeBrief(brief: Pick<IntakeBrief, 'summary' | 'briefText'>): string {
  const summary = brief.summary.trim();
  const detail = brief.briefText.trim();
  if (!detail) return summary.slice(0, 2000);
  const combined = `${summary}\n\n${detail}`;
  return combined.slice(0, 2000).trimEnd();
}

export interface IntakeSuggestions {
  title?: string;
  summary?: string;
  duration?: string;
  aspectRatios?: IntakeAspectRatio[];
  quantity?: number;
  channels?: IntakeChannel[];
  startsOn?: string;
  dueOn?: string;
  budgetBand?: IntakeBudgetBand;
  contactChannel?: IntakeContactChannel;
  contactValue?: string;
  matchedFields: string[];
}

function normalizeCalendarDay(yearRaw: string, monthRaw: string, dayRaw: string): string | null {
  const y = Number(yearRaw);
  const m = Number(monthRaw);
  const d = Number(dayRaw);
  if (!Number.isInteger(y) || y < 2024 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Deterministic, hallucination-free field extractor from pasted or uploaded brief text.
 * Only populates fields explicitly found in `raw`; unknown fields remain `undefined` so the
 * customer sees honest blanks rather than guessed dates or budgets.
 */
export function extractIntakeSuggestions(raw: string): IntakeSuggestions {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return { matchedFields: [] };

  const out: IntakeSuggestions = { matchedFields: [] };
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[#>*\-•\s]+/, '').trim())
    .filter(Boolean);

  // Title: explicit label or short leading heading line.
  const titleMatch = text.match(/(?:프로젝트\s*명|캠페인\s*명|제목|Project(?:\s*Name)?|Title)\s*[:：]\s*([^\n]{3,100})/i);
  if (titleMatch?.[1]) {
    out.title = titleMatch[1].trim().slice(0, 120);
    out.matchedFields.push('title');
  } else if (lines[0] && lines[0].length >= 4 && lines[0].length <= 60 && !lines[0].includes('http')) {
    out.title = lines[0].slice(0, 120);
    out.matchedFields.push('title');
  }

  // Summary / goal line.
  const goalMatch = text.match(/(?:한\s*줄\s*목표|캠페인\s*목표|목표|목적|개요|핵심\s*메시지|Objective|Goal|Summary)\s*[:：]\s*([^\n]{4,300})/i);
  if (goalMatch?.[1]) {
    out.summary = goalMatch[1].trim().slice(0, 500);
    out.matchedFields.push('summary');
  }

  // Aspect ratios.
  const ratios: IntakeAspectRatio[] = [];
  for (const r of INTAKE_ASPECT_RATIOS) {
    const escaped = r.replace(':', '\\s*[:xX×]\\s*');
    if (new RegExp(`(?:^|[^0-9])${escaped}(?:[^0-9]|$)`).test(text)) ratios.push(r);
  }
  if (ratios.length === 0) {
    if (/세로형|릴스형|숏폼/.test(text)) ratios.push('9:16');
    if (/가로형|와이드/.test(text)) ratios.push('16:9');
  }
  if (ratios.length > 0) {
    out.aspectRatios = [...new Set(ratios)];
    out.matchedFields.push('aspectRatios');
  }

  // Duration (e.g. 15초, 30초, 15s, 60 sec).
  const durMatch = text.match(/(?:^|[^\d:])(\d{1,3})\s*(?:초(?![A-Za-z0-9])|(?:sec(?:onds?)?|s)\b)/i);
  if (durMatch?.[1]) {
    const sec = Number(durMatch[1]);
    if (sec >= 3 && sec <= 300) {
      out.duration = `${sec}초`;
      out.matchedFields.push('duration');
    }
  }

  // Deliverable quantity (e.g. 총 3편, 영상 5본, 4종).
  const qtyMatch =
    text.match(/(?:수량|편수|총|영상)\s*[:：]?\s*(\d{1,3})\s*(?:편|본|개|건|종)/) ??
    text.match(/(?:^|[^\d])(\d{1,2})\s*(?:편|본)(?![가-힣A-Za-z0-9])/);
  if (qtyMatch?.[1]) {
    const qty = Number(qtyMatch[1]);
    if (qty >= 1 && qty <= 500) {
      out.quantity = qty;
      out.matchedFields.push('quantity');
    }
  }

  // Channels.
  const channels: IntakeChannel[] = [];
  if (/릴스|인스타|instagram|reels/i.test(text)) channels.push('instagram_reels');
  if (/틱톡|tiktok/i.test(text)) channels.push('tiktok');
  if (/쇼츠|shorts/i.test(text)) channels.push('youtube_shorts');
  if (/유튜브|youtube/i.test(text) && !channels.includes('youtube_shorts')) channels.push('youtube');
  if (/자사몰|홈페이지|웹사이트|공식몰|owned\s*web/i.test(text)) channels.push('owned_web');
  if (/광고\s*집행|퍼포먼스|메타\s*광고|유료\s*광고|paid/i.test(text)) channels.push('paid_ads');
  if (channels.length > 0) {
    out.channels = [...new Set(channels)];
    out.matchedFields.push('channels');
  }

  // Dates (YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, YYYY년 M월 D일).
  const dateRegex = /(20\d{2})\s*(?:[-./]|년\s*)\s*(\d{1,2})\s*(?:[-./]|월\s*)\s*(\d{1,2})\s*일?/g;
  const foundDates: string[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRegex.exec(text)) !== null) {
    const iso = normalizeCalendarDay(dm[1]!, dm[2]!, dm[3]!);
    if (iso && !foundDates.includes(iso)) foundDates.push(iso);
  }
  foundDates.sort();
  if (foundDates[0]) {
    out.startsOn = foundDates[0];
    out.matchedFields.push('startsOn');
  }
  if (foundDates[1] && foundDates[1] >= foundDates[0]!) {
    out.dueOn = foundDates[1];
    out.matchedFields.push('dueOn');
  }

  // Budget band (만 원 / 천만 원 / KRW).
  const manMatch = text.match(/(\d[\d,]*)\s*만\s*원/);
  const cheonManMatch = text.match(/(\d+(?:\.\d+)?)\s*천만\s*원/);
  let manWon: number | null = null;
  if (cheonManMatch?.[1]) {
    manWon = Math.round(Number(cheonManMatch[1]) * 1000);
  } else if (manMatch?.[1]) {
    manWon = Number(manMatch[1].replace(/,/g, ''));
  }
  if (manWon !== null && Number.isFinite(manWon) && manWon > 0) {
    out.budgetBand =
      manWon < 300
        ? 'under_300'
        : manWon < 500
          ? '300_500'
          : manWon <= 1000
            ? '500_1000'
            : manWon <= 3000
              ? '1000_3000'
              : 'over_3000';
    out.matchedFields.push('budgetBand');
  } else if (/예산\s*[:：]?\s*(?:미정|협의|추후|상담|모름)/i.test(text)) {
    out.budgetBand = 'undecided';
    out.matchedFields.push('budgetBand');
  }

  // Contact email or phone.
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch?.[0]) {
    out.contactChannel = 'email';
    out.contactValue = emailMatch[0].toLowerCase();
    out.matchedFields.push('contact');
  } else {
    const phoneMatch = text.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);
    if (phoneMatch?.[0]) {
      out.contactChannel = 'phone';
      out.contactValue = phoneMatch[0];
      out.matchedFields.push('contact');
    }
  }

  return out;
}

/** Strip XML tags from OOXML (`word/document.xml`, `ppt/slides/slide*.xml`, `Contents/section*.xml`). */
function xmlToPlainText(xml: string): string {
  return xml
    .replace(/<\/(?:w:p|a:p|hp:p|p|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Lightweight client/server ZIP text reader for `.docx`, `.pptx`, and `.hwpx` files.
 * Reads local file headers (`PK\x03\x04`) and extracts XML text entries without external dependencies.
 */
async function extractZipXmlText(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLen + extraLen;
    // Bit 3 data descriptor without known size: stop linear scan cleanly.
    if ((flags & 0x08) !== 0 && compSize === 0) break;
    if (dataStart + compSize > bytes.byteLength) break;
    const entryName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    if (
      /^(?:word\/document\.xml|ppt\/slides\/slide\d+\.xml|Contents\/section\d+\.xml)$/i.test(entryName)
    ) {
      const slice = bytes.subarray(dataStart, dataStart + compSize);
      const raw = method === 0 ? slice : method === 8 ? await inflateRawBytes(slice) : null;
      if (raw) {
        const text = xmlToPlainText(decoder.decode(raw));
        if (text) chunks.push(text);
      }
    }
    offset = dataStart + compSize;
  }
  return chunks.join('\n\n').slice(0, 16_000);
}

/** Extract readable literal text strings from simple PDF content streams when uncompressed. */
function extractPdfLiteralText(bytes: Uint8Array): string {
  const latin = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.byteLength, 512_000)));
  const parts: string[] = [];
  const literal = /\(([^()\\]{3,200})\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(latin)) !== null) {
    const cleaned = m[1]!.replace(/[^\p{L}\p{N}\s.,:/\-@()~%]/gu, '').trim();
    if (cleaned.length >= 3) parts.push(cleaned);
    if (parts.length >= 200) break;
  }
  return parts.join('\n').slice(0, 12_000);
}

/** Best-effort text extraction from an uploaded brief file (TXT/MD/CSV/DOCX/PPTX/HWPX/PDF). */
export async function extractTextFromBriefFile(name: string, mime: string, bytes: Uint8Array): Promise<string> {
  const lower = name.toLowerCase();
  if (mime.startsWith('text/') || /\.(?:txt|md|csv)$/i.test(lower)) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 64_000)).trim().slice(0, 16_000);
  }
  if (
    /\.(?:docx|pptx|hwpx)$/i.test(lower) ||
    mime.includes('officedocument') ||
    mime.includes('hwpml')
  ) {
    return extractZipXmlText(bytes);
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractPdfLiteralText(bytes);
  }
  return '';
}

/** Browser-safe public HTTPS link normalizer (matches server `normalizeBrandHttpsUrl` without `node:net`). */
export function normalizeClientHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const bareHost = hostname.replace(/^\[|\]$/g, '');
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bareHost) || bareHost.includes(':');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hostname.includes('.') ||
      isIpLiteral ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname) ||
      /[\u0000-\u0020\u007f\\]/.test(raw)
    ) {
      return null;
    }
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
