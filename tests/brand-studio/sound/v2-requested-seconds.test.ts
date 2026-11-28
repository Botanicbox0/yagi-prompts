import { describe, expect, it } from 'vitest';
import { parseRequestedSeconds } from '@/lib/brand-studio/sound/requested-seconds';

describe('parseRequestedSeconds (Korean and English explicit durations, false-positives & ambiguity -> null)', () => {
  const CASES: ReadonlyArray<{ label: string; input: string; expected: number | null }> = [
    // Positive Korean forms
    { label: 'Korean compact seconds (30초)', input: '30초', expected: 30 },
    { label: 'Korean spaced seconds (30 초)', input: '30 초', expected: 30 },
    { label: 'Korean 90초 over MiniMax cap', input: '90초 런칭 티저 배경음, 점점 고조되게', expected: 90 },
    { label: 'Korean suffix 초짜리 (15초짜리)', input: '15초짜리 신나는 스킨케어 광고 음악, 여자 보컬', expected: 15 },
    { label: 'Korean suffix 초간 (45초간)', input: '차분한 피아노 선율이 45초간 이어지는 배경음', expected: 45 },
    { label: 'Korean 1분', input: '1분 어쿠스틱 브랜드 송', expected: 60 },
    { label: 'Korean 2분', input: '2분 미니멀 앰비언트 배경음악', expected: 120 },
    { label: 'Korean decimal minutes 1.5분', input: '1.5분 감성 브이로그 배경음', expected: 90 },
    { label: 'Korean decimal minutes 0.5분', input: '0.5분 티저 음악', expected: 30 },
    { label: 'Korean decimal minutes 2.5분', input: '2.5분 어쿠스틱 팝', expected: 150 },
    { label: 'Korean compound 1분 30초', input: '1분 30초 감성 브랜드 필름 음악', expected: 90 },
    { label: 'Korean compound compact 1분30초', input: '1분30초짜리 오프닝 테마', expected: 90 },
    { label: 'Korean compound spaced 2 분 15 초', input: '약 2 분 15 초 분량의 잔잔한 기타', expected: 135 },
    { label: 'Korean range 10~15초 -> upper bound 15', input: '10~15초 스킨케어 숏폼 광고', expected: 15 },
    { label: 'Korean range 15-30초 -> upper bound 30', input: '15-30초 브랜드 릴스 배경음', expected: 30 },
    { label: 'Korean minutes range 1~1.5분 -> upper bound 90', input: '1~1.5분 브랜드 필름 음악', expected: 90 },
    { label: 'Korean boundary 1초', input: '1초 효과음 같은 짧은 스팅', expected: 1 },
    { label: 'Korean boundary 10분 (600s)', input: '10분 매장 배경 음악', expected: 600 },

    // Positive English forms
    { label: 'English 15s compact (non-multiple of 10)', input: '15s', expected: 15 },
    { label: 'English 45s compact (non-multiple of 10)', input: '45s warm acoustic jingle', expected: 45 },
    { label: 'English 15 s spaced', input: ' upbeat synth pop 15 s ', expected: 15 },
    { label: 'English 30 sec at start of brief', input: '30 sec sunlit coffee commercial, upbeat indie pop vocals', expected: 30 },
    { label: 'English 15 sec', input: '15 sec product reveal cue', expected: 15 },
    { label: 'English 45 secs', input: 'Warm Rhodes groove, 45 secs.', expected: 45 },
    { label: 'English 15 second singular', input: 'A 15 second fast tech product reveal', expected: 15 },
    { label: 'English 15 seconds plural', input: '15 seconds upbeat acoustic jingle', expected: 15 },
    { label: 'English hyphenated 30-second', input: 'Clean 30-second skincare spot', expected: 30 },
    { label: 'English 1 min', input: '1 min ambient pad', expected: 60 },
    { label: 'English 2 mins', input: '2 mins chill lo-fi beat', expected: 120 },
    { label: 'English 1 minute', input: '1 minute gentle piano intro', expected: 60 },
    { label: 'English 2 minutes', input: 'Upbeat dance pop, 2 minutes', expected: 120 },
    { label: 'English decimal minutes 1.5 min', input: '1.5 min chill lo-fi beat', expected: 90 },
    { label: 'English decimal minutes 2.5 minutes', input: '2.5 minutes warm indie underscore', expected: 150 },
    { label: 'English compound 1m 30s', input: '1m 30s launch film underscore', expected: 90 },
    { label: 'English compound 1 min 30 sec', input: '1 min 30 sec warm indie track', expected: 90 },
    { label: 'English compound 1 minute and 15 seconds', input: 'Run for 1 minute and 15 seconds with soft strings', expected: 75 },
    { label: 'English range 10-15 sec -> upper bound 15', input: '10-15 sec tech launch cue', expected: 15 },
    { label: 'English range 15~30 seconds -> upper bound 30', input: '15~30 seconds upbeat spot', expected: 30 },
    { label: 'English range 10~15s -> upper bound 15', input: '10~15s social bumper', expected: 15 },
    { label: 'English minutes range 1-2 min -> upper bound 120', input: '1-2 min ambient underscore', expected: 120 },
    { label: 'Decade ignored alongside real Korean duration', input: '80s synthwave 스타일 30초 광고 음악', expected: 30 },
    { label: 'Age group ignored alongside real English duration', input: 'Gen Z 20s 타깃 15 sec 숏폼', expected: 15 },
    { label: 'Same duration repeated in two ways (single distinct value)', input: '30초 광고 음악 (30 seconds)', expected: 30 },

    // Negative: bare `s` multiples of 10 (decades, ages, reverb tails) -> null
    { label: 'bare 10s', input: '10s', expected: null },
    { label: '10s of reverb tail', input: '10s of reverb tail', expected: null },
    { label: 'bare 20s', input: '20s', expected: null },
    { label: 'Gen Z 20s 타깃', input: 'Gen Z 20s 타깃', expected: null },
    { label: 'bare 30s', input: '30s', expected: null },
    { label: 'age range 20-30s', input: '20-30s 직장인 타깃 광고 음악', expected: null },
    { label: 'bare 70s', input: '70s', expected: null },
    { label: 'late 70s', input: 'late 70s', expected: null },
    { label: 'late 70s funk', input: 'late 70s funk', expected: null },
    { label: '80s synthwave', input: '80s synthwave', expected: null },
    { label: '90s hip hop 느낌', input: '90s hip hop 느낌', expected: null },
    { label: "apostrophe decade ('80s)", input: "Warm '80s synthwave with gated reverb snare", expected: null },
    { label: 'hyphenated decade (late-80s)', input: 'late-80s gated snare, chorus-washed guitars', expected: null },
    { label: 'four-digit decade (1980s)', input: '1980s Japanese city pop groove', expected: null },

    // Negative: Korean fractions and time signatures (`분` + `의` + digit) -> null
    { label: 'Korean fraction 3분의 1', input: '3분의 1', expected: null },
    { label: '곡의 3분의 1 지점에서 드롭', input: '곡의 3분의 1 지점에서 드롭', expected: null },
    { label: 'Korean time signature 4분의 3박자', input: '4분의 3박자 따뜻한 왈츠', expected: null },

    // Negative: multi-duration ambiguity (> 1 distinct duration) -> null
    { label: 'ambiguous intro + total (15초 인트로가 있는 1분짜리 곡)', input: '15초 인트로가 있는 1분짜리 곡', expected: null },
    { label: 'ambiguous total + cue point (30초 ... 10초 지점에 드롭)', input: '30초 스킨케어 광고 음악, 10초 지점에 드롭', expected: null },
    { label: 'ambiguous compound + intro (1분 30초 ... 첫 15초는)', input: '1분 30초 브랜드 필름, 첫 15초는 피아노 솔로', expected: null },
    { label: 'ambiguous English two durations', input: '15 sec intro leading into a 60 sec main theme', expected: null },

    // Negative: non-duration numbers, spelled-out words, zero, negative, > 600 -> null
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
    { label: 'spelled-out Korean words (삼십초)', input: '삼십초 상쾌한 광고 음악', expected: null },
    { label: 'Korean quarter (4분기)', input: '2026년 4분기 브랜드 런칭 티저', expected: null },
    { label: 'Korean split (3분할)', input: '3분할 화면 전환에 어울리는 리듬감', expected: null },
    { label: 'Korean mood noun (분위기)', input: '1가지 따뜻한 분위기의 어쿠스틱 팝', expected: null },
    { label: 'Korean exceeding (10초과)', input: '트랙 수 10초과 없이 심플하게', expected: null },
    { label: 'Korean early age/decade (20대 초반)', input: '20대 초반 타깃 상쾌한 탄산수 광고', expected: null },
    { label: 'aspect ratio 9:16 and 16:9', input: '9:16 릴스와 16:9 가로 영상 겸용 배경음', expected: null },
    { label: 'sample rate & bit depth (44.1kHz 16-bit)', input: 'Clean studio mix 44.1kHz 16-bit', expected: null },
    { label: 'English s-words & min-words', input: '3 songs, 2 synths, 4 stems, 3 minimal pads in 1 minor key', expected: null },
    { label: 'decimal seconds (15.5s)', input: 'Cut at 15.5s mark', expected: null },
    { label: 'zero Korean seconds (0초)', input: '0초', expected: null },
    { label: 'zero seconds in sentence (0초 / 0s)', input: '0초 대기 없이 0s 시작', expected: null },
    { label: 'negative Korean seconds (-15초)', input: '-15초', expected: null },
    { label: 'negative English seconds (-15 sec)', input: '-15 sec', expected: null },
    { label: 'unicode minus Korean seconds (−15초)', input: '−15초', expected: null },
    { label: 'over 10-minute ceiling (601초)', input: '601초 배경음', expected: null },
    { label: 'over 10-minute ceiling (1000초)', input: '1000초 앰비언트 배경음', expected: null },
    { label: 'over 10-minute ceiling in minutes (11분)', input: '11분 매장 배경음', expected: null },
  ];

  it(`covers ${CASES.length} positive, decade/age/fraction false-positive, range, decimal-minute, and ambiguity cases`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)('$label: $input -> $expected', ({ input, expected }) => {
    expect(parseRequestedSeconds(input)).toBe(expected);
  });
});
