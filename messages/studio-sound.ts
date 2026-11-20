/**
 * Sound studio copy (docs/BRAND-SOUND-STUDIO.md §4.7), wired into the dictionaries as `studioSound`. Both
 * languages live here so one owner edits one file.
 *
 * Wording: the lines from §4.7 went through local Gemma 4 in two passes for the design (2026-11-20). The
 * screen-only lines added in slice SS1 (search, upload, row controls, the project picker, the replace
 * question) went through the same two passes on 2026-11-20 and were checked against what the screen does.
 * Taken from pass 2 except: names stay names (`untitledUpload`/`untitledMade` are row titles, so no
 * sentence ending), `more` keeps the workspace's own "더보기", and the failure line asks plainly
 * ("다시 시도해 주세요") instead of pass 2's "다시 시도해요". `replaceTitle` was reworded after the screen check:
 * a quoted name ending in a consonant took the wrong particle ("…음원"를), so it says "대신" and needs none.
 *
 * Slice SS2 (music by description): the composer, examples, versions, save, copy and error lines are §4.7 lines
 * where §4.7 has them; the rest went through the same two Gemma passes on 2026-11-20. Taken from pass 2 (examples
 * as a song's description, not an order; buttons ending in a verb noun) except: `composer.label` stays a label,
 * error lines say "빠지지 않았어요" like §4.7 instead of "차감되지", and "다시 시도해 주세요" instead of "다시 시도해요".
 * `composer.making` is the first sentence of §4.7's "만드는 동안" line: its "{seconds}초 정도" waits for the measured
 * time of the paid smoke test (§4.7, §7.7) and is not shown until then.
 *
 * Slice SS3 (music with lyrics, "더 고르게 만들기", the terms line and panel): §4.7 lines as they are. The
 * terms lines (marked † in §4.7) wait for the founder's final wording and the terms clauses (§8-3); they are the
 * §4.7 drafts until then. The panel's fourth line ("download the creation record") waits for that download to exist.
 * New lines (drafting, draft failure, draft limit, close) went through the same two Gemma
 * passes on 2026-11-20; pass 2 was taken for both of its changes.
 *
 * Slice SA1 (the music Prompt Architect, §12.2): the switch's name and the shared verbs are the image studio's own
 * approved lines (Prompt Architect, 지금 설계하기, 프롬프트를 설계하고 있어요., 원래 문장으로, 설계하지 못했어요…,
 * 크레딧은 들지 않아요., 보낸 문장 보기, 보낸 문장, 입력한 문장). `architect.tip` and `architect.designed` are the
 * §12.7 lines as reviewed (two Gemma passes, PR #292, both languages). `fallbackNote`, `styleLabel` and `titleLabel`
 * went through the same two passes on the evening of 2026-11-20 (the arbiter answered again); pass 1 changed
 * 입력하신 → 입력한 and kept the two labels, pass 2 changed none of them.
 *
 * Slice SA2 (the lyrics engine, §12.3): `lyricsKit`. The lines §12.7 lists are its reviewed versions as merged in
 * #292 (two Gemma passes, both languages): ownNote, polish, polishNote, length, lengthNote, the three structures,
 * readAs (label and example). The word "후크" (structures) is the founder's to approve; it lives only here. The other
 * lines went through two local Gemma passes on 2026-11-20 and follow the reviewed verb (고치기): polishing,
 * polishFailed and polished were re-worded from 손보다 to 고치다 to match it (see the PR body for their Gemma check).
 *
 * Slice SA3 (warnings, §12.5): the blocked lines take the §12.7 reviewed additions as merged in #292 (two Gemma
 * passes): `errors.artist` and `composer.lyricsBlocked` keep their first sentence and add the reviewed one,
 * `errors.blocked` (the engine refused), `errors.redesign` (다르게 설계하기) and `errors.paused` are the reviewed lines.
 *
 * Review 1 (2026-11-21): `lyricsKit.ownNote` no longer says an ending is added (END_MARK is held out); `more` and
 * `moreSet` are the options disclosure. All three went through two local Gemma passes; pass 2 gave
 * "가사는 바꾸지 않고 구간 표시만 더해요." and "더 보기", taken as written. When the ending rule is decided, ownNote can
 * say so again.
 *
 * Amounts are credits, never won. No engine, vendor or model name appears here.
 */
export const studioSoundEn = {
  title: 'Sound Studio',
  lead: 'Create background music for your ads and social media.',
  tabsLabel: 'Sound type',
  tabs: { music: 'Music', sfx: 'SFX' },
  empty: { music: 'No music created yet.', sfx: 'No sound effects yet.' },
  sfxUse: 'Add to a video in the Editing Studio.',
  search: { label: 'Search sounds', placeholder: 'Search by name' },
  likedOnly: 'Liked',
  noMatch: 'Nothing matches.',
  upload: {
    button: 'Upload',
    hint: 'MP3 or WAV, up to {mb} MB',
    uploading: 'Uploading',
    failed: "Couldn't upload the file.",
  },
  row: {
    play: 'Play {name}',
    pause: 'Pause {name}',
    expand: 'Show {name}',
    collapse: 'Hide {name}',
    untitledUpload: 'Audio uploaded {date}',
    untitledMade: 'Sound made {date}',
    more: 'More for {name}',
    like: 'Like {name}',
    unlike: 'Unlike {name}',
  },
  actions: {
    sendCompose: 'Send to Editing Studio',
    addVideo: 'Add to Video Studio',
    download: 'Download',
  },
  composer: {
    label: 'Describe the music',
    placeholder: 'Describe the mood, instruments, and tempo. (e.g., Calm piano)',
    vocals: 'Vocals',
    noVocals: 'No vocals',
    withVocals: 'With vocals',
    lengthNote: 'Adjust the length after creating.',
    create: 'Create',
    createLabel: 'Create, {credits} credits',
    creating: 'Starting',
    making: 'Creating music.',
    versions: '{count} versions created.',
    lyrics: 'Lyrics',
    lyricsPlaceholder: 'Enter lyrics or leave blank.',
    lyricsLanguage: 'Sings in the language you write.',
    lyricsBlocked: 'You cannot use existing lyrics or artist names. Please enter your own lyrics or try creating a lyric draft.',
    draft: 'Draft lyrics',
    draftNote: 'Review and edit the draft.',
    drafting: 'Drafting',
    draftFailed: "Couldn't draft lyrics. Please try again.",
    draftBusy: 'Too many requests. Please try again in a moment.',
    careful: 'Consistent output',
    carefulNote: 'More consistent quality. Costs double credits.',
  },
  architect: {
    name: 'Prompt Architect',
    tip: 'Reads the description and designs the prompt for the music.',
    free: 'No credits are used.',
    designNow: 'Design now',
    designing: 'Designing the prompt.',
    designed: 'Designed for your music. You can use it as is or edit it.',
    undo: 'Back to my words',
    failed: "Couldn't design it. You can still create with your own words.",
    fallbackNote: 'We sent your words with only basic directions added.',
    styleLabel: 'Designed prompt',
    titleLabel: 'Song title',
    sentToggle: 'Show what was sent',
    sentLabel: 'Sent',
    yourWords: 'Your words',
  },
  lyricsKit: {
    ownNote: 'Your lyrics remain unchanged; only section markers are added.',
    polish: 'Adjust for singing',
    polishing: 'Adjusting the lyrics.',
    polishNote: 'Adjusts the phrasing for better singing while keeping the meaning.',
    polishFailed: "Couldn't adjust the lyrics. Please try again.",
    current: 'Your lyrics',
    polished: 'Adjusted',
    accept: 'Apply',
    keep: 'Keep mine',
    options: 'Lyrics options',
    length: 'Match lyric amount',
    seconds: '{n}s',
    lengthNote: "Adjusts length by the amount of lyrics; finalize with 'Fit length' after creating.",
    structure: 'Structure',
    structures: { hook: 'Hook only', 'hook-verse': 'Hook & 1 Verse', full: '2 Verses & Hook' },
    tone: 'Tone',
    tones: { haeyo: 'Polite', banmal: 'Casual' },
    language: 'Language',
    languages: { ko: 'Korean', en: 'English', mixed: 'Mixed' },
    brand: 'Brand name',
    readAs: 'Brand pronunciation',
    readAsExample: 'e.g., Twings',
    mustInclude: 'Words to include',
    mustIncludeHint: 'Separate with commas',
    videoLength: 'Video length',
    more: 'More',
    moreSet: '{n} set',
    videoPick: 'Choose a video',
    previewShow: 'See lyrics to send',
    previewHide: 'Hide lyrics to send',
    preview: 'Lyrics to send',
  },
  terms: {
    link: 'Terms',
    title: 'Terms',
    line: 'Use in ads and social media. No royalties or attribution required.',
    points: [
      'Each request creates a new piece of music.',
      'Use in ads and social media posts. No royalties or attribution required.',
      'We do not register this music in content identification systems.',
    ],
    close: 'Close',
  },
  examples: {
    label: 'Example descriptions',
    skincare: 'Clean, calm, slow piano',
    fashion: 'Sleek, urban beat at a fast tempo',
    shortform: 'Bouncy, upbeat synth track, fast',
    launch: 'Grand, confident orchestral piece at a medium tempo',
  },
  version: 'Version {letter}',
  more: {
    save: 'Save to assets',
    saved: 'Saved to assets',
    similar: 'Create similar',
    copy: 'Copy description',
    copied: 'Copied',
  },
  errors: {
    failed: 'Failed to create music. No credits were used.',
    artist: 'Please avoid artist names or song titles. Please describe using genre, tempo, instruments, or voice instead of names.',
    blocked: 'Unable to create music with this description. No credits were used.',
    redesign: 'Redesign description',
    paused: 'Please try again in a moment.',
    allowance: 'Not enough credits this month.',
    closed: "Creating music isn't available for this workspace right now.",
    busy: 'Too much music is being made at once. Please try again shortly.',
    generic: 'Something went wrong. Please try again.',
  },
  send: {
    sentCompose: 'Sent to Editing Studio.',
    pickTitle: 'Add to which video project?',
    newProject: 'Add to a new project',
    noProjects: 'No video projects yet.',
    loading: 'Loading projects',
    replaceTitle: 'Use this music instead of "{current}"?',
    replace: 'Replace',
    cancel: 'Cancel',
    sentVideo: 'Added to Video Studio.',
    open: 'Open',
    sfxFull: 'A project can hold up to 24 sound effects.',
    failed: "Couldn't send it. Please try again.",
  },
};

export type StudioSoundCopy = typeof studioSoundEn;

export const studioSoundKo: StudioSoundCopy = {
  title: '사운드 스튜디오',
  lead: '광고와 SNS 영상에 쓸 배경 음악을 만들어요.',
  tabsLabel: '소리 종류',
  tabs: { music: '음악', sfx: '효과음' },
  empty: { music: '만든 음악이 아직 없어요.', sfx: '만든 효과음이 없어요.' },
  sfxUse: '영상에 넣어서 쓰는 소리예요. 편집 스튜디오로 보내세요.',
  search: { label: '사운드 검색', placeholder: '이름으로 검색하세요' },
  likedOnly: '좋아요만 보기',
  noMatch: '검색 결과가 없어요.',
  upload: {
    button: '올리기',
    hint: 'MP3 또는 WAV 파일을 {mb}MB까지 올릴 수 있어요.',
    uploading: '올리는 중이에요.',
    failed: '파일을 올리지 못했어요.',
  },
  row: {
    play: '{name} 재생하기',
    pause: '{name} 멈추기',
    expand: '{name} 펼치기',
    collapse: '{name} 접기',
    untitledUpload: '{date}에 올린 음원',
    untitledMade: '{date}에 만든 소리',
    more: '{name} 더보기',
    like: '{name} 좋아요',
    unlike: '{name} 좋아요 취소',
  },
  actions: {
    sendCompose: '편집 스튜디오로 보내기',
    addVideo: '영상 스튜디오에 넣기',
    download: '내려받기',
  },
  composer: {
    label: '음악 설명',
    placeholder: '분위기, 악기, 빠르기를 적어 주세요. (예: 차분한 피아노 곡)',
    vocals: '보컬',
    noVocals: '보컬 없음',
    withVocals: '보컬 있음',
    lengthNote: '곡마다 길이가 달라요. 만든 후 조절하세요.',
    create: '만들기',
    createLabel: '{credits}크레딧으로 만들기',
    creating: '만드는 중이에요.',
    making: '음악을 만들고 있어요.',
    versions: '{count}개의 버전이 만들어졌어요.',
    lyrics: '가사',
    lyricsPlaceholder: '가사를 입력하세요. 비워 두면 자동으로 만들어져요.',
    lyricsLanguage: '쓴 언어 그대로 노래해요.',
    lyricsBlocked: '기존 노래 가사나 가수 이름은 넣을 수 없어요. 직접 쓴 가사를 넣거나 가사 초안을 만들어 보세요.',
    draft: '가사 초안 만들기',
    draftNote: '초안을 확인하고 고쳐 쓰세요.',
    drafting: '초안을 만들고 있어요.',
    draftFailed: '초안을 만들지 못했어요. 다시 시도해 주세요.',
    draftBusy: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    careful: '더 고르게 만들기',
    carefulNote: '곡이 더 고르게 나오고 크레딧이 두 배로 들어요.',
  },
  architect: {
    name: 'Prompt Architect',
    tip: '설명을 읽고 음악에 맞춰 프롬프트를 설계해요.',
    free: '크레딧은 들지 않아요.',
    designNow: '지금 설계하기',
    designing: '프롬프트를 설계하고 있어요.',
    designed: '음악에 맞게 설계했어요. 그대로 쓰거나 수정해도 돼요.',
    undo: '원래 문장으로',
    failed: '설계하지 못했어요. 작성한 문장 그대로 생성할 수 있어요.',
    fallbackNote: '입력한 문장에 기본 지시만 더해 보냈어요.',
    styleLabel: '설계한 프롬프트',
    titleLabel: '곡 제목',
    sentToggle: '보낸 문장 보기',
    sentLabel: '보낸 문장',
    yourWords: '입력한 문장',
  },
  lyricsKit: {
    ownNote: '가사는 바꾸지 않고 구간 표시만 더해요.',
    polish: '노래에 맞게 고치기',
    polishing: '가사를 고치고 있어요.',
    polishNote: '뜻은 그대로 두고 노래하기 좋게 고쳐요. 확인하면 적용돼요.',
    polishFailed: '가사를 고치지 못했어요. 다시 시도해 주세요.',
    current: '쓴 가사',
    polished: '고친 가사',
    accept: '적용하기',
    keep: '유지하기',
    options: '가사 옵션',
    length: '가사 분량 맞추기',
    seconds: '{n}초',
    lengthNote: '가사 양으로 길이를 맞추고, 만든 뒤 길이 맞추기로 마무리해요.',
    structure: '구성',
    structures: { hook: '후크만', 'hook-verse': '후크와 한 절', full: '두 절과 후크' },
    tone: '말투',
    tones: { haeyo: '해요체', banmal: '반말' },
    language: '언어',
    languages: { ko: '한국어', en: '영어', mixed: '한국어·영어 섞어 쓰기' },
    brand: '브랜드 이름',
    readAs: '브랜드 이름 읽는 법',
    readAsExample: '예: 트윙스',
    mustInclude: '꼭 넣을 말',
    mustIncludeHint: '쉼표로 구분해 입력',
    videoLength: '영상 길이',
    more: '더 보기',
    moreSet: '{n}개 설정됨',
    videoPick: '영상 선택',
    previewShow: '보낼 가사 보기',
    previewHide: '보낼 가사 닫기',
    preview: '보낼 가사',
  },
  terms: {
    link: '이용 조건',
    title: '이용 조건',
    line: '광고와 SNS에 쓸 수 있어요. 사용료를 낼 필요가 없고 출처를 적지 않아도 돼요.',
    points: [
      '요청할 때마다 새로 만든 음악이에요.',
      '광고와 SNS 게시물에 쓸 수 있어요. 사용료를 낼 필요가 없고 출처를 적지 않아도 돼요.',
      '이 음악을 음원 식별 시스템에 등록하지 않아요.',
    ],
    close: '닫기',
  },
  examples: {
    label: '예시 설명',
    skincare: '깨끗하고 차분한 분위기의 느린 피아노 곡',
    fashion: '세련되고 도시적인 비트의 빠른 곡',
    shortform: '통통 튀고 경쾌한 신시사이저 사운드의 빠른 곡',
    launch: '웅장하고 신뢰감 있는 중간 속도의 오케스트라 곡',
  },
  version: '버전 {letter}',
  more: {
    save: '에셋에 저장하기',
    saved: '에셋에 저장했어요',
    similar: '비슷하게 만들기',
    copy: '설명 복사하기',
    copied: '복사했어요',
  },
  errors: {
    failed: '음악을 만들지 못했어요. 크레딧은 빠지지 않았어요.',
    artist: '가수 이름이나 곡 제목은 넣을 수 없어요. 이름 대신 장르, 빠르기, 악기, 목소리로 설명해 주세요.',
    blocked: '이번 설명으로는 음악을 만들 수 없어요. 크레딧은 빠지지 않았어요.',
    redesign: '다르게 설계하기',
    paused: '잠시 뒤에 다시 시도해 주세요.',
    allowance: '이번 달 크레딧이 부족해요.',
    closed: '지금은 이 워크스페이스에서 음악을 만들 수 없어요.',
    busy: '동시에 만드는 음악이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    generic: '문제가 생겼어요. 다시 시도해 주세요.',
  },
  send: {
    sentCompose: '편집 스튜디오로 보냈어요.',
    pickTitle: '어느 영상 프로젝트에 넣을까요?',
    newProject: '새 프로젝트를 만들어 넣기',
    noProjects: '아직 영상 프로젝트가 없어요.',
    loading: '프로젝트를 불러오는 중이에요.',
    replaceTitle: '"{current}" 대신 이 음악을 넣을까요?',
    replace: '바꾸기',
    cancel: '취소',
    sentVideo: '영상 스튜디오에 넣었어요.',
    open: '열기',
    sfxFull: '프로젝트 하나에 효과음은 24개까지 넣을 수 있어요.',
    failed: '넣지 못했어요. 다시 시도해 주세요.',
  },
};
