/**
 * Chat-based timeline editing engine (`docs/BRAND-VIDEO-COMPOSE-D.md` §2-2).
 *
 * 1. Deterministic Korean + English parser (`parseComposeChatCommand`) runs with zero latency and zero
 *    API cost for everyday editing instructions (trim, reorder/swap, delete, captions, music/clip volume,
 *    aspect ratio, undo, and multi-clause instructions).
 * 2. Optional user-supplied BYOK API key adapter (`requestByokTimelinePatches`) runs strictly in browser
 *    memory against OpenAI or Anthropic official APIs and validates structured `TimelinePatch[]` output
 *    with Zod — never touching consumer OAuth tokens or TWINGS backend storage.
 */
import { z } from 'zod';
import {
  COMPOSE_ASPECTS,
  type CaptionPosition,
  type CaptionSize,
  type ComposeAspect,
  type ComposerProject,
  type TimelinePatch,
} from './timeline';

export type ComposeChatOutcome =
  | { kind: 'undo' }
  | { kind: 'patches'; patches: TimelinePatch[]; detail: string }
  | { kind: 'unrecognized' };

const KOR_ORDINAL_WORDS: ReadonlyArray<[RegExp, number]> = [
  [/(?:첫\s*번째|첫째|맨\s*앞|처음\s*(?:컷|클립|장면))/i, 0],
  [/(?:두\s*번째|둘째)/i, 1],
  [/(?:세\s*번째|셋째)/i, 2],
  [/(?:네\s*번째|넷째)/i, 3],
  [/(?:다섯\s*번째|다섯째)/i, 4],
  [/(?:여섯\s*번째|여섯째)/i, 5],
];

const ENG_ORDINAL_WORDS: ReadonlyArray<[RegExp, number]> = [
  [/\bfirst\b/i, 0],
  [/\bsecond\b/i, 1],
  [/\bthird\b/i, 2],
  [/\bfourth\b/i, 3],
  [/\bfifth\b/i, 4],
];

function resolveClipIndex(clause: string, clipCount: number): number | null {
  const maxIdx = Math.max(0, clipCount - 1);
  if (/(?:마지막|맨\s*뒤|맨\s*끝|\blast\b)\s*(?:컷|클립|장면|영상|clip|cut|shot)?/i.test(clause)) {
    return clipCount > 0 ? maxIdx : 0;
  }
  const numKor = /(\d+)\s*(?:번째|번)\s*(?:컷|클립|장면|영상)?/i.exec(clause);
  if (numKor) return Math.max(0, Number(numKor[1]) - 1);
  const numEng = /\b(?:clip|cut|shot|#)\s*(\d+)\b/i.exec(clause) ?? /\b(\d+)(?:st|nd|rd|th)\s*(?:clip|cut|shot)?\b/i.exec(clause);
  if (numEng) return Math.max(0, Number(numEng[1]) - 1);
  for (const [pattern, index] of KOR_ORDINAL_WORDS) {
    if (pattern.test(clause)) return index;
  }
  for (const [pattern, index] of ENG_ORDINAL_WORDS) {
    if (pattern.test(clause)) return index;
  }
  return null;
}

function extractQuotedText(clause: string): string | null {
  const match =
    /['"“”‘’「」『』]([^'"“”‘’「」『』]{1,120})['"“”‘’「」『』]/.exec(clause) ??
    /\[([^\]]{1,120})\]/.exec(clause);
  return match?.[1]?.trim() ? match[1].trim() : null;
}

function splitCompoundClauses(input: string): string[] {
  // Preserve quoted text while splitting compound conjunctions ("줄이고", "바꾸고", "그리고", "and").
  const placeholders: string[] = [];
  const masked = input.replace(/['"“”‘’「」『』][^'"“”‘’「」『』]*['"“”‘’「」『』]/g, (quoted) => {
    placeholders.push(quoted);
    return `__QUOTE_${placeholders.length - 1}__`;
  });
  const rawParts = masked
    .split(/(?:\s*(?:,|;|그리고|그런\s*다음|그\s*다음|\band\s+then\b|\bthen\b|\band\b)\s*)|(?<=(?:줄이|바꾸|옮기|지우|넣|켜|끄|낮추|높이|자르))고\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return rawParts.map((part) =>
    part.replace(/__QUOTE_(\d+)__/g, (_, idx) => placeholders[Number(idx)] ?? ''),
  );
}

function describePatch(patch: TimelinePatch, locale: 'ko' | 'en'): string {
  const ko = locale === 'ko';
  switch (patch.op) {
    case 'set_aspect':
      return ko ? `비율 ${patch.aspect}` : `aspect ${patch.aspect}`;
    case 'trim_clip':
      if (patch.targetDurationSec !== undefined) {
        return ko ? `${patch.clipIndex + 1}번 컷 ${patch.targetDurationSec}초` : `cut ${patch.clipIndex + 1} → ${patch.targetDurationSec}s`;
      }
      return ko ? `${patch.clipIndex + 1}번 컷 구간 조절` : `trimmed cut ${patch.clipIndex + 1}`;
    case 'move_clip':
      return ko ? `${patch.fromIndex + 1}번 → ${patch.toIndex + 1}번 이동` : `moved cut ${patch.fromIndex + 1} → ${patch.toIndex + 1}`;
    case 'swap_clips':
      return ko ? `${patch.indexA + 1}번·${patch.indexB + 1}번 순서 교환` : `swapped cut ${patch.indexA + 1} & ${patch.indexB + 1}`;
    case 'remove_clip':
      return ko ? `${patch.clipIndex + 1}번 컷 삭제` : `removed cut ${patch.clipIndex + 1}`;
    case 'set_clip_audio':
      return ko ? '클립 원본 소리 조절' : 'adjusted clip sound';
    case 'add_caption':
      return ko ? `자막 "${patch.text}" 추가` : `added caption "${patch.text}"`;
    case 'update_caption':
      return ko ? `${patch.captionIndex + 1}번 자막 수정` : `updated caption ${patch.captionIndex + 1}`;
    case 'remove_caption':
      return ko ? '자막 삭제' : 'removed caption';
    case 'set_bgm_volume':
      return ko ? `배경음악 볼륨 ${Math.round(patch.volume * 100)}%` : `music volume ${Math.round(patch.volume * 100)}%`;
    case 'remove_bgm':
      return ko ? '배경음악 제거' : 'removed music';
  }
}

function parseSingleClause(clause: string, project: ComposerProject): TimelinePatch | null {
  const clipCount = project.clips.length;

  // 1. Aspect ratio
  const explicitAspect = /(9\s*:\s*16|16\s*:\s*9|4\s*:\s*5|1\s*:\s*1)/.exec(clause);
  if (explicitAspect) {
    const aspect = explicitAspect[1]!.replace(/\s+/g, '') as ComposeAspect;
    if ((COMPOSE_ASPECTS as readonly string[]).includes(aspect)) return { op: 'set_aspect', aspect };
  }
  if (/(?:비율|화면|가로|세로|정사각|aspect|vertical|horizontal|landscape|square)/i.test(clause)) {
    if (/(?:가로|와이드|유튜브|\bwide\b|\blandscape\b|\bhorizontal\b)/i.test(clause)) return { op: 'set_aspect', aspect: '16:9' };
    if (/(?:세로|릴스|쇼츠|\bvertical\b|\bportrait\b)/i.test(clause)) return { op: 'set_aspect', aspect: '9:16' };
    if (/(?:정사각|\bsquare\b)/i.test(clause)) return { op: 'set_aspect', aspect: '1:1' };
    if (/(?:피드|\bfeed\b)/i.test(clause)) return { op: 'set_aspect', aspect: '4:5' };
  }

  // 2. Caption clear / remove / add
  if (/(?:자막|캡션|글자|문구|\bcaptions?\b|\bsubtitles?\b)/i.test(clause)) {
    if (/(?:모두|다|전체|\ball\b).*(?:지워|삭제|빼|없애|clear|remove|delete)|(?:지워|삭제|clear|remove|delete).*(?:모두|다|전체|\ball\b)\s*(?:자막|캡션|captions?)/i.test(clause)) {
      return { op: 'remove_caption', captionIndex: 'all' };
    }
    if (/(?:지워|삭제|빼|없애|\bremove\b|\bdelete\b)/i.test(clause) && !extractQuotedText(clause)) {
      const idx = resolveClipIndex(clause, project.captions.length) ?? Math.max(0, project.captions.length - 1);
      return { op: 'remove_caption', captionIndex: project.captions.length <= 1 ? 'all' : idx };
    }
    const quoted = extractQuotedText(clause);
    const unquotedKor = /(?:마지막에|처음에|화면에|상단에|하단에|가운데에)?\s*([^'"“”]+?)\s*(?:자막|문구|캡션)(?:을|를)?\s*(?:넣|추가|써|띄워)/.exec(clause);
    const fallbackText = unquotedKor?.[1]
      ?.replace(/^(?:마지막에|처음에|맨\s*뒤에|맨\s*앞에|\d+(?:\.\d+)?초(?:부터|\s*~\s*\d+(?:\.\d+)?초까지)?)\s*/, '')
      .trim();
    const text = quoted ?? (fallbackText && fallbackText.length <= 60 ? fallbackText : null);
    if (text) {
      const position: CaptionPosition = /(?:상단|위쪽|맨\s*위|\btop\b)/i.test(clause)
        ? 'top'
        : /(?:가운데|중앙|\bcenter\b|\bmiddle\b)/i.test(clause)
          ? 'center'
          : 'bottom';
      const size: CaptionSize = /(?:크게|큰\s*글씨|\blarge\b|\bbig\b)/i.test(clause)
        ? 'lg'
        : /(?:작게|작은\s*글씨|\bsmall\b)/i.test(clause)
          ? 'sm'
          : 'md';
      const rangeMatch =
        /(\d+(?:\.\d+)?)\s*(?:초|s)?\s*(?:부터|~|-|\bto\b)\s*(\d+(?:\.\d+)?)\s*(?:초|s)/i.exec(clause) ??
        /\bfrom\s*(\d+(?:\.\d+)?)\s*s?\s*to\s*(\d+(?:\.\d+)?)\s*s?\b/i.exec(clause);
      if (rangeMatch) {
        return {
          op: 'add_caption',
          text,
          startSec: Number(rangeMatch[1]),
          endSec: Number(rangeMatch[2]),
          position,
          size,
        };
      }
      const durMatch = /(\d+(?:\.\d+)?)\s*(?:초\s*동안|초간|\bseconds?\b|\bs\b)/i.exec(clause);
      const durationSec = durMatch ? Number(durMatch[1]) : 2.5;
      const anchor: 'start' | 'end' | 'full' = /(?:전체|내내|끝까지\s*계속|\bfull\b|\bentire\b)/i.test(clause)
        ? 'full'
        : /(?:마지막|끝|맨\s*뒤|엔딩|\bend\b|\boutro\b)/i.test(clause)
          ? 'end'
          : 'start';
      return { op: 'add_caption', text, anchor, durationSec, position, size };
    }
  }

  // 3. BGM / Music controls
  if (/(?:배경\s*음악|배경음|음악|\bbgm\b|\bmusic\b)/i.test(clause)) {
    if (/(?:빼|삭제|제거|없애|\bremove\b|\bclear\b)/i.test(clause)) {
      return { op: 'remove_bgm' };
    }
    if (/(?:꺼|음소거|무음|\bmute\b|\boff\b)/i.test(clause)) {
      return { op: 'set_bgm_volume', volume: 0, muted: true };
    }
    const pct = /(\d{1,3})\s*%/.exec(clause);
    if (pct) {
      return { op: 'set_bgm_volume', volume: Math.min(100, Number(pct[1])) / 100 };
    }
    if (/(?:낮춰|줄여|작게|\blower\b|\bquieter\b|\bsofter\b)/i.test(clause)) {
      const current = project.bgm?.volume ?? 0.5;
      return { op: 'set_bgm_volume', volume: Math.max(0.1, current - 0.25) };
    }
    if (/(?:높여|키워|크게|\blouder\b|\braise\b)/i.test(clause)) {
      const current = project.bgm?.volume ?? 0.5;
      return { op: 'set_bgm_volume', volume: Math.min(1, current + 0.25) };
    }
  }

  // 4. Clip original sound / audio controls
  if (/(?:원본\s*소리|클립\s*소리|영상\s*소리|소리|오디오|볼륨|\bclip\s*audio\b|\bsound\b|\bmute\b|\bunmute\b|\bvolume\b)/i.test(clause)) {
    const targetIdx = /(?:모두|다|전체|\ball\b)/i.test(clause) ? ('all' as const) : (resolveClipIndex(clause, clipCount) ?? ('all' as const));
    if (/(?:꺼|음소거|무음|\bmute\b|\boff\b)/i.test(clause)) {
      return { op: 'set_clip_audio', clipIndex: targetIdx, volume: 0, muted: true };
    }
    if (/(?:켜|살려|\bunmute\b|\bon\b)/i.test(clause)) {
      return { op: 'set_clip_audio', clipIndex: targetIdx, volume: 1, muted: false };
    }
    const pct = /(\d{1,3})\s*%/.exec(clause);
    if (pct) {
      const vol = Math.min(100, Number(pct[1])) / 100;
      return { op: 'set_clip_audio', clipIndex: targetIdx, volume: vol, muted: vol === 0 };
    }
  }

  // 5. Swap two clips ("1번과 2번 순서 바꿔줘", "swap clip 1 and 2")
  const swapKor = /(\d+)\s*(?:번째|번)(?:컷|클립)?\s*(?:과|와|이랑|하고|,)\s*(\d+)\s*(?:번째|번).*?(?:바꿔|교환|맞바꿔)/i.exec(clause);
  if (swapKor) {
    return { op: 'swap_clips', indexA: Math.max(0, Number(swapKor[1]) - 1), indexB: Math.max(0, Number(swapKor[2]) - 1) };
  }
  const swapEng = /\bswap\s*(?:clip|cut|shot)?\s*(\d+)\s*(?:and|with|&)\s*(?:clip|cut|shot)?\s*(\d+)/i.exec(clause);
  if (swapEng) {
    return { op: 'swap_clips', indexA: Math.max(0, Number(swapEng[1]) - 1), indexB: Math.max(0, Number(swapEng[2]) - 1) };
  }
  if (clipCount >= 2 && /^(?:순서\s*바꿔|앞뒤\s*바꿔|reverse\s*order)/i.test(clause.trim())) {
    return { op: 'swap_clips', indexA: 0, indexB: 1 };
  }

  // 6. Move clip ("3번째 클립 맨 앞으로", "1번 클립 맨 뒤로", "move clip 3 to 1")
  if (/(?:옮겨|이동|보내|\bmove\b)/i.test(clause)) {
    const fromIndex = resolveClipIndex(clause, clipCount);
    if (fromIndex !== null) {
      if (/(?:맨\s*앞|처음으로|\bto\s*(?:the\s*)?(?:start|first|front|beginning)\b)/i.test(clause)) {
        return { op: 'move_clip', fromIndex, toIndex: 0 };
      }
      if (/(?:맨\s*뒤|마지막으로|끝으로|\bto\s*(?:the\s*)?(?:end|last|back)\b)/i.test(clause)) {
        return { op: 'move_clip', fromIndex, toIndex: Math.max(0, clipCount - 1) };
      }
      const destKor = /(\d+)\s*(?:번째|번)\s*(?:자리|위치)?로/i.exec(clause);
      const destEng = /\bto\s*(?:position|slot|clip|cut|#)?\s*(\d+)\b/i.exec(clause);
      const dest = destKor ? Number(destKor[1]) - 1 : destEng ? Number(destEng[1]) - 1 : null;
      if (dest !== null && dest >= 0) {
        return { op: 'move_clip', fromIndex, toIndex: dest };
      }
    }
  }

  // 7. Delete / remove clip ("마지막 컷 삭제", "2번 클립 빼줘", "delete cut 2")
  if (/(?:삭제|빼|제거|지워|\bdelete\b|\bremove\b|\bdrop\b)/i.test(clause)) {
    const clipIndex = resolveClipIndex(clause, clipCount);
    if (clipIndex !== null) {
      return { op: 'remove_clip', clipIndex };
    }
  }

  // 8. Trim clip range / cut front or back / set target duration
  const clipIndex = resolveClipIndex(clause, clipCount) ?? 0;
  const clip = project.clips[clipIndex];

  const rangeTrim =
    /(\d+(?:\.\d+)?)\s*(?:초|s)?\s*(?:부터|~|-|\bto\b)\s*(\d+(?:\.\d+)?)\s*(?:초|s)/i.exec(clause);
  if (rangeTrim && /(?:잘라|자르|남기|쓰기|구간|\btrim\b|\bcut\b|\bkeep\b)/i.test(clause)) {
    return {
      op: 'trim_clip',
      clipIndex,
      trimStartSec: Number(rangeTrim[1]),
      trimEndSec: Number(rangeTrim[2]),
    };
  }

  const cutFront =
    /(?:앞|앞부분|처음)\s*(\d+(?:\.\d+)?)\s*(?:초|s).*?(?:잘라|자르|빼)/i.exec(clause) ??
    /\b(?:cut|trim)\s*(?:the\s*)?(?:first|front)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\b/i.exec(clause);
  if (cutFront && clip) {
    return {
      op: 'trim_clip',
      clipIndex,
      trimStartSec: clip.trimStartSec + Number(cutFront[1]),
    };
  }

  const cutBack =
    /(?:뒤|뒷부분|끝)\s*(\d+(?:\.\d+)?)\s*(?:초|s).*?(?:잘라|자르|빼)/i.exec(clause) ??
    /\b(?:cut|trim)\s*(?:the\s*)?(?:last|end|back)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\b/i.exec(clause);
  if (cutBack && clip) {
    return {
      op: 'trim_clip',
      clipIndex,
      trimEndSec: Math.max(0.3, clip.trimEndSec - Number(cutBack[1])),
    };
  }

  const targetDur =
    /(\d+(?:\.\d+)?)\s*(?:초|seconds?|s)(?:로|으로)?\s*(?:줄여|줄이|맞춰|만들어|자르|잘라|변경|설정)/i.exec(clause) ??
    /\b(?:trim|cut|shorten|set)\b.*?\bto\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\b/i.exec(clause);
  if (targetDur) {
    return {
      op: 'trim_clip',
      clipIndex,
      targetDurationSec: Number(targetDur[1]),
    };
  }

  return null;
}

export function parseComposeChatCommand(
  message: string,
  project: ComposerProject,
  locale: 'ko' | 'en' = 'ko',
): ComposeChatOutcome {
  const trimmed = message.trim();
  if (!trimmed) return { kind: 'unrecognized' };

  if (/^(?:되돌려|되돌리기|방금\s*전(?:으로)?|취소해\s*줘?|실행\s*취소|원래대로|\bundo\b|\brevert\b)/i.test(trimmed)) {
    return { kind: 'undo' };
  }

  const clauses = splitCompoundClauses(trimmed);
  const patches: TimelinePatch[] = [];
  for (const clause of clauses) {
    const patch = parseSingleClause(clause, project);
    if (patch) patches.push(patch);
  }

  if (patches.length === 0) {
    const single = parseSingleClause(trimmed, project);
    if (single) patches.push(single);
  }

  if (patches.length === 0) {
    return { kind: 'unrecognized' };
  }

  const detail = patches.map((patch) => describePatch(patch, locale)).join(', ');
  return { kind: 'patches', patches, detail };
}

/* ---------------------------------------------------------- Optional Browser-Only BYOK Adapter */

export type ByokProvider = 'openai' | 'anthropic';

const TimelinePatchSchema: z.ZodType<TimelinePatch> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_aspect'), aspect: z.enum(COMPOSE_ASPECTS) }),
  z.object({
    op: z.literal('trim_clip'),
    clipIndex: z.number().int().min(0),
    trimStartSec: z.number().min(0).optional(),
    trimEndSec: z.number().min(0.3).optional(),
    targetDurationSec: z.number().min(0.3).optional(),
  }),
  z.object({ op: z.literal('move_clip'), fromIndex: z.number().int().min(0), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal('swap_clips'), indexA: z.number().int().min(0), indexB: z.number().int().min(0) }),
  z.object({ op: z.literal('remove_clip'), clipIndex: z.number().int().min(0) }),
  z.object({
    op: z.literal('set_clip_audio'),
    clipIndex: z.union([z.number().int().min(0), z.literal('all')]),
    volume: z.number().min(0).max(1).optional(),
    muted: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('add_caption'),
    text: z.string().min(1).max(120),
    startSec: z.number().min(0).optional(),
    endSec: z.number().min(0.3).optional(),
    anchor: z.enum(['start', 'end', 'full']).optional(),
    durationSec: z.number().min(0.3).optional(),
    position: z.enum(['bottom', 'center', 'top']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
  }),
  z.object({
    op: z.literal('update_caption'),
    captionIndex: z.number().int().min(0),
    text: z.string().min(1).max(120).optional(),
    startSec: z.number().min(0).optional(),
    endSec: z.number().min(0.3).optional(),
    position: z.enum(['bottom', 'center', 'top']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
  }),
  z.object({
    op: z.literal('remove_caption'),
    captionIndex: z.union([z.number().int().min(0), z.literal('all')]),
  }),
  z.object({ op: z.literal('set_bgm_volume'), volume: z.number().min(0).max(1), muted: z.boolean().optional() }),
  z.object({ op: z.literal('remove_bgm') }),
]);

const ByokResponseSchema = z.object({
  patches: z.array(TimelinePatchSchema).min(1).max(12),
});

export async function requestByokTimelinePatches(options: {
  provider: ByokProvider;
  apiKey: string;
  message: string;
  project: ComposerProject;
  locale: 'ko' | 'en';
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; patches: TimelinePatch[]; detail: string } | { ok: false }> {
  const key = options.apiKey.trim();
  if (!key) return { ok: false };
  const fetcher = options.fetchImpl ?? fetch;
  const stateSummary = {
    aspect: options.project.aspect,
    clips: options.project.clips.map((c, idx) => ({
      clipIndex: idx,
      label: c.label,
      durationSec: c.durationSec,
      trimStartSec: c.trimStartSec,
      trimEndSec: c.trimEndSec,
      volume: c.volume,
      muted: c.muted,
    })),
    captions: options.project.captions.map((c, idx) => ({
      captionIndex: idx,
      text: c.text,
      startSec: c.startSec,
      endSec: c.endSec,
      position: c.position,
    })),
    hasBgm: Boolean(options.project.bgm),
    bgmVolume: options.project.bgm?.volume ?? null,
  };

  const systemPrompt = [
    'Convert the user video timeline editing request into JSON matching {"patches":[...]} only.',
    'Allowed patch ops (0-based indices):',
    '- {"op":"set_aspect","aspect":"9:16"|"16:9"|"4:5"|"1:1"}',
    '- {"op":"trim_clip","clipIndex":0,"trimStartSec":0,"trimEndSec":3,"targetDurationSec":3}',
    '- {"op":"move_clip","fromIndex":2,"toIndex":0}',
    '- {"op":"swap_clips","indexA":0,"indexB":1}',
    '- {"op":"remove_clip","clipIndex":0}',
    '- {"op":"set_clip_audio","clipIndex":0|"all","volume":0.8,"muted":false}',
    '- {"op":"add_caption","text":"...","anchor":"start"|"end"|"full","durationSec":2.5,"position":"bottom"|"center"|"top","size":"sm"|"md"|"lg"}',
    '- {"op":"remove_caption","captionIndex":0|"all"}',
    '- {"op":"set_bgm_volume","volume":0.3}',
    '- {"op":"remove_bgm"}',
    `Current timeline: ${JSON.stringify(stateSummary)}`,
  ].join('\n');

  try {
    let rawJson = '';
    if (options.provider === 'openai') {
      const res = await fetcher('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          temperature: 0,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: options.message.slice(0, 500) },
          ],
        }),
      });
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      rawJson = data.choices?.[0]?.message?.content ?? '';
    } else {
      const res = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 600,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: options.message.slice(0, 500) }],
        }),
      });
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const textBlock = data.content?.find((b) => b.type === 'text')?.text ?? '';
      const jsonMatch = /\{[\s\S]*\}/.exec(textBlock);
      rawJson = jsonMatch ? jsonMatch[0] : textBlock;
    }

    const parsed = ByokResponseSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) return { ok: false };
    const detail = parsed.data.patches.map((p) => describePatch(p, options.locale)).join(', ');
    return { ok: true, patches: parsed.data.patches, detail };
  } catch {
    return { ok: false };
  }
}
