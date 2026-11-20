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
    artist: 'Please avoid artist names or song titles. Describe the mood, instruments, and tempo instead.',
    blocked: "This description can't be used. No credits were used.",
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
    artist: '가수 이름이나 곡 제목은 넣을 수 없어요. 분위기, 악기, 빠르기로 설명해 주세요.',
    blocked: '사용할 수 없는 설명이에요. 크레딧은 빠지지 않았어요.',
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
