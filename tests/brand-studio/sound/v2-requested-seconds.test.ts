import { describe, expect, it } from 'vitest';
import { parseRequestedSeconds } from '@/lib/brand-studio/sound/requested-seconds';

describe('parseRequestedSeconds (Korean and English explicit durations, non-durations ignored)', () => {
  const CASES: ReadonlyArray<{ label: string; input: string; expected: number | null }> = [
    // Required positive Korean forms
    { label: 'Korean compact seconds (30초)', input: '30초', expected: 30 },
    { label: 'Korean spaced seconds (30 초)', input: '30 초', expected: 30 },
    { label: 'Korean 90초 over MiniMax cap', input: '90초 런칭 티저 배경음, 점점 고조되게', expected: 90 },
    { label: 'Korean suffix 초짜리 (15초짜리)', input: '15초짜리 신나는 스킨케어 광고 음악, 여자 보컬', expected: 15 },
    { label: 'Korean suffix 초간 (45초간)', input: '차분한 피아노 선율이 45초간 이어지는 배경음', expected: 45 },
    { label: 'Korean 1분', input: '1분 어쿠스틱 브랜드 송', expected: 60 },
    { label: 'Korean 2분', input: '2분 미니멀 앰비언트 배경음악', expected: 120 },
    { label: 'Korean compound 1분 30초', input: '1분 30초 감성 브랜드 필름 음악', expected: 90 },
    { label: 'Korean compound compact 1분30초', input: '1분30초짜리 오프닝 테마', expected: 90 },
    { label: 'Korean compound spaced 2 분 15 초', input: '약 2 분 15 초 분량의 잔잔한 기타', expected: 135 },
    { label: 'Korean boundary 1초', input: '1초 효과음 같은 짧은 스팅', expected: 1 },
    { label: 'Korean boundary 10분 (600s)', input: '10분 매장 배경 음악', expected: 600 },

    // Required positive English forms
    { label: 'English 15s compact', input: '15s', expected: 15 },
    { label: 'English 30s at start of brief', input: '30s sunlit coffee commercial, upbeat indie pop vocals', expected: 30 },
    { label: 'English 15 s spaced', input: ' upbeat synth pop 15 s ', expected: 15 },
    { label: 'English 15 sec', input: '15 sec product reveal cue', expected: 15 },
    { label: 'English 45 secs', input: 'Warm Rhodes groove, 45 secs.', expected: 45 },
    { label: 'English 15 second singular', input: 'A 15 second fast tech product reveal', expected: 15 },
    { label: 'English 15 seconds plural', input: '15 seconds upbeat acoustic jingle', expected: 15 },
    { label: 'English hyphenated 30-second', input: 'Clean 30-second skincare spot', expected: 30 },
    { label: 'English 1 min', input: '1 min ambient pad', expected: 60 },
    { label: 'English 2 mins', input: '2 mins chill lo-fi beat', expected: 120 },
    { label: 'English 1 minute', input: '1 minute gentle piano intro', expected: 60 },
    { label: 'English 2 minutes', input: 'Upbeat dance pop, 2 minutes', expected: 120 },
    { label: 'English compound 1m 30s', input: '1m 30s launch film underscore', expected: 90 },
    { label: 'English compound 1 min 30 sec', input: '1 min 30 sec warm indie track', expected: 90 },
    { label: 'English compound 1 minute and 15 seconds', input: 'Run for 1 minute and 15 seconds with soft strings', expected: 75 },

    // Required negative / non-duration cases -> null
    { label: 'empty string', input: '', expected: null },
    { label: 'whitespace only', input: '   \n\t  ', expected: null },
    { label: 'year 2026', input: '2026 봄/여름 컬렉션 캠페인 음악', expected: null },
    { label: 'verse count (3 verses)', input: 'Indie folk song with 3 verses and a bright chorus', expected: null },
    { label: 'BPM prefix (BPM 120)', input: 'Bright dance-pop, BPM 120, punchy kick', expected: null },
    { label: 'bpm suffix (120bpm)', input: '신나는 하우스 비트 120bpm 여성 보컬', expected: null },
    { label: 'spaced BPM (118 BPM)', input: 'Warm city pop around 118 BPM', expected: null },
    { label: 'hours in Korean (24시간)', input: '24시간 편의점 야간 감성 광고 음악', expected: null },
    { label: 'hours in English (2 hours)', input: 'Late-night drive after 2 hours on the road', expected: null },
    { label: 'spelled-out English words (one minute)', input: 'one minute calm piano score', expected: null },
    { label: 'Korean quarter (4분기)', input: '2026년 4분기 브랜드 런칭 티저', expected: null },
    { label: 'Korean split (3분할)', input: '3분할 화면 전환에 어울리는 리듬감', expected: null },
    { label: 'Korean mood noun (분위기)', input: '1가지 따뜻한 분위기의 어쿠스틱 팝', expected: null },
    { label: 'Korean exceeding (10초과)', input: '트랙 수 10초과 없이 심플하게', expected: null },
    { label: 'Korean early age/decade (20대 초반)', input: '20대 초반 타깃 상쾌한 탄산수 광고', expected: null },
    { label: 'aspect ratio 9:16 and 16:9', input: '9:16 릴스와 16:9 가로 영상 겸용 배경음', expected: null },
    { label: 'sample rate & bit depth (44.1kHz 16-bit)', input: 'Clean studio mix 44.1kHz 16-bit', expected: null },
    { label: 'apostrophe decade (\'80s)', input: "Warm '80s synthwave with gated reverb snare", expected: null },
    { label: 'hyphenated decade (late-80s)', input: 'late-80s gated snare, chorus-washed guitars', expected: null },
    { label: 'four-digit decade (1980s)', input: '1980s Japanese city pop groove', expected: null },
    { label: 'English s-words & min-words (songs, synths, stems, minimal, minor)', input: '3 songs, 2 synths, 4 stems, 3 minimal pads in 1 minor key', expected: null },
    { label: 'decimal seconds (15.5s)', input: 'Cut at 15.5s mark', expected: null },
    { label: 'zero seconds (0초 / 0s)', input: '0초 대기 없이 0s 시작', expected: null },
    { label: 'over 10-minute ceiling (601초)', input: '601초 배경음', expected: null },
  ];

  it.each(CASES)('$label: $input -> $expected', ({ input, expected }) => {
    expect(parseRequestedSeconds(input)).toBe(expected);
  });

  it('picks the earliest stated duration when a brief mentions a total length and a later cue point', () => {
    expect(parseRequestedSeconds('30초 스킨케어 광고 음악, 10초 지점에 드롭')).toBe(30);
    expect(parseRequestedSeconds('1분 30초 브랜드 필름, 첫 15초는 피아노 솔로')).toBe(90);
  });
});
