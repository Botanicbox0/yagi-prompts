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
