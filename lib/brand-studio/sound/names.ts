/**
 * Real singers, groups and songs are not taken in a description (docs/BRAND-SOUND-STUDIO.md §5): the request
 * is refused before any credit is reserved, with a line asking for mood, instruments and tempo instead. No
 * rewriting into "in the style of": the customer changes the words.
 *
 * A name list, not a judgement: it catches the names people actually type, it never proves a description is
 * clean, and the engine filters names on its side too. Matching ignores case, spaces and punctuation, and a
 * Latin name only matches as a whole word, so "bts" catches "BTS 느낌" but not "subtle beats".
 *
 * Client-safe: the composer runs the same check before a press, the server runs it again.
 */
const ARTISTS: readonly string[] = [
  // Korean
  // Short names that are also ordinary words (있지, 지수, rose, crush, queen, 10cm…) are left out on purpose.
  'bts', '방탄소년단', 'blackpink', '블랙핑크', 'newjeans', '뉴진스', '아이브', 'aespa', '에스파', 'le sserafim', '르세라핌',
  'twice', '트와이스', 'seventeen', '세븐틴', 'stray kids', '스트레이 키즈', '스트레이키즈', 'exo', '엑소', 'bigbang',
  '아이유', 'red velvet', '레드벨벳', 'nct', '엔시티', 'itzy', '(g)i-dle', '여자아이들', 'illit', '아일릿',
  'babymonster', '베이비몬스터', 'riize', 'zerobaseone', '제로베이스원', '투모로우바이투게더', 'enhypen', '엔하이픈',
  'ateez', '에이티즈', 'kiss of life', '키스오브라이프', 'g-dragon', '지드래곤', 'jennie', 'rosé', 'blackpink lisa',
  'jisoo', 'jungkook', 'jimin', 'psy', '싸이', 'taeyeon', '태연', 'sung si kyung', '성시경', '임영웅',
  'zico', '지코', 'heize', '헤이즈', 'akmu', '악뮤', '악동뮤지션', 'day6', '데이식스', 'hyukoh', '혁오',
  'jannabi', '잔나비', '십센치', 'big naughty', '빅나티', 'lee mujin', '이무진', 'bol4', '볼빨간사춘기', 'paul kim', '폴킴',
  // Global
  'taylor swift', '테일러 스위프트', 'beyonce', 'beyoncé', '비욘세', 'drake', '드레이크', 'ariana grande', '아리아나 그란데',
  'billie eilish', '빌리 아일리시', 'ed sheeran', '에드 시런', 'the weeknd', '위켄드', 'bruno mars', '브루노 마스', 'dua lipa', '두아 리파',
  'adele', '아델', 'rihanna', '리한나', 'justin bieber', '저스틴 비버', 'olivia rodrigo', '올리비아 로드리고', 'harry styles', '해리 스타일스',
  'lady gaga', '레이디 가가', 'kendrick lamar', '켄드릭 라마', 'travis scott', '트래비스 스캇', 'post malone', '포스트 말론', 'sza',
  'doja cat', '도자 캣', 'coldplay', '콜드플레이', 'imagine dragons', '이매진 드래곤스', 'maroon 5', '마룬 5', '마룬5', 'sabrina carpenter',
  '사브리나 카펜터', 'charli xcx', '찰리 xcx', 'daft punk', '다프트 펑크', 'calvin harris', '캘빈 해리스', 'avicii', '아비치', 'the beatles',
  '비틀즈', 'michael jackson', '마이클 잭슨', 'eminem', '에미넴', 'kanye west', '카니예', 'hans zimmer', '한스 짐머', 'joe hisaishi',
  '히사이시 조', 'ryuichi sakamoto', '류이치 사카모토', 'yoasobi', '요아소비',
];

/** Phrases that point at someone else's song even without a name ("in the style of 80s disco" stays allowed). */
const SONG_HINTS: readonly RegExp[] = [/\bsong by\b/i, /\bcover of\b/i];

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function hangulOrLatin(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  // A Latin name must stand alone (no letters right before or after); a Korean one may carry a particle.
  return /[a-z0-9]/.test(name) ? new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i') : new RegExp(escaped);
}

const PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = ARTISTS.filter((name) => name.length >= 2 || /[가-힣]/.test(name)).map((name) => ({
  name,
  pattern: hangulOrLatin(fold(name)),
}));

/** The first artist name or song reference found in `text`, or null. */
export function namedArtist(text: string): string | null {
  const folded = fold(text);
  for (const { name, pattern } of PATTERNS) if (pattern.test(folded)) return name;
  for (const hint of SONG_HINTS) if (hint.test(folded)) return 'song';
  return null;
}
