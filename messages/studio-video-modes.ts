/**
 * Video studio modes (slice VM-1): final strings for the 3-mode dock switch
 * (`기본` / `Re-Architect` / `Motion Transfer`), empty-video well, `!` popover,
 * and first-use visual explainer. Passed to the client ONLY when `BRAND_STUDIO_VIDEO_MODES` is open.
 *
 * Every numeric limit in prose is a placeholder filled at render time from existing constants/model.
 */
export const studioVideoModesEn = {
  modes: {
    label: 'Video making mode',
    basic: 'Basic',
    reArchitect: 'Re-Architect',
    motionTransfer: 'Motion Transfer',
  },
  oneLiners: {
    basic: 'Make a new video from text and images.',
    reArchitect: 'Read the reference video’s direction and remake it with your product and cast.',
    motionTransfer: 'Follow the reference video’s motion and timing.',
  },
  tip: {
    buttonLabel: '{mode} guide',
    giveLabel: 'Inputs',
    keepLabel: 'Reflected',
    getLabel: 'Output',
    basic: {
      give: 'Add a prompt, up to {maxImages} reference images, and audio.',
      keep: 'Reflects your chosen start and end frames and reference images.',
      get: 'Receive a {minSeconds}–{maxSeconds} s video as a draft or at your chosen resolution.',
    },
    reArchitect: {
      give: 'Add a reference video ({refMin} s–{refMaxMinutes} min) and details for the product, cast, or place to swap in.',
      keep: 'Reads and reflects the reference video’s shot structure, camera movement, and pacing.',
      get: 'Receive a newly generated draft without using the original footage (up to {maxClips} clips).',
    },
    motionTransfer: {
      give: 'Add a reference video ({refMin}–{refMaxSeconds} s) and images or notes for what should change.',
      keep: 'Follows the reference video’s motion and timing.',
      get: 'Receive a new video reflecting the source motion.',
    },
    motionHonestNotes: {
      faceColor: 'People or colours from the reference video may remain in the result.',
      extraCredits: 'Extra credits apply for the length of the reference video.',
    },
  },
  well: {
    title: 'Add a reference video',
    dropNow: 'Drop here to attach as the reference video',
    limitsReArchitect: '{min} s–{maxMinutes} min · up to {maxMb} MB · {formats}',
    limitsMotionTransfer: '{min}–{max} s · up to {maxMb} MB · {formats}',
    pickFile: 'Choose file',
    pickLibrary: 'Pick from library',
    openReverse: 'Open shot table',
  },
  status: {
    needVideo: 'Add a reference video first',
    videoRemoved: 'Reference video removed',
    undo: 'Undo',
    switchToEdit: 'Edit only part of this clip',
    backToReference: 'Back to following motion',
    gotIt: 'Got it',
    readAgain: 'Read again',
  },
  explainer: {
    label: '{mode} guide',
    reArchitect: {
      step1: 'Reference clip',
      step2: 'Direction shot table',
      step3: 'New clip with your assets',
      shot1: '0.0–3.2 s · Close-up',
      shot2: '3.2–7.5 s · Pan',
      shot3: '7.5–12.0 s · Wide',
      mine1: 'Your product',
      mine2: 'Your cast',
      mine3: 'Your place',
    },
    motionTransfer: {
      step1: 'Reference motion',
      step2: 'Apply to your subject',
      step3: 'Same timing, new clip',
      motionTag: 'Motion & timing',
    },
  },
};

export const studioVideoModesKo: typeof studioVideoModesEn = {
  modes: {
    label: '영상 만들기 방식',
    basic: '기본',
    reArchitect: 'Re-Architect',
    motionTransfer: 'Motion Transfer',
  },
  oneLiners: {
    basic: '글과 이미지로 새 영상을 만들어요.',
    reArchitect: '참고 영상의 연출을 읽어 내 제품과 인물로 다시 만들어요.',
    motionTransfer: '참고 영상의 움직임과 타이밍을 따라가요.',
  },
  tip: {
    buttonLabel: '{mode} 설명',
    giveLabel: '입력 항목',
    keepLabel: '반영되는 것',
    getLabel: '결과물',
    basic: {
      give: '프롬프트와 참고 이미지(최대 {maxImages}장), 오디오를 넣어요.',
      keep: '지정한 시작·끝 프레임과 참고 이미지를 반영해요.',
      get: '{minSeconds}~{maxSeconds}초 영상을 초안이나 선택한 해상도로 받아요.',
    },
    reArchitect: {
      give: '참고 영상({refMin}초~{refMaxMinutes}분)과 바꿀 제품·인물·장소 정보를 넣어요.',
      keep: '참고 영상의 컷 구성, 카메라 움직임, 리듬을 읽어 반영해요.',
      get: '원본 화면을 쓰지 않고 새로 만든 초안을 받아요(최대 {maxClips}개 클립).',
    },
    motionTransfer: {
      give: '참고 영상({refMin}~{refMaxSeconds}초)과 바꿀 요소의 이미지나 글을 넣어요.',
      keep: '참고 영상의 움직임과 타이밍을 따라가요.',
      get: '원본 움직임을 반영한 새 영상을 받아요.',
    },
    motionHonestNotes: {
      faceColor: '참고 영상의 인물이나 색감이 결과에 남을 수 있어요.',
      extraCredits: '참고 영상 길이만큼 크레딧이 더 들어요.',
    },
  },
  well: {
    title: '참고할 영상을 넣어 주세요',
    dropNow: '여기에 놓으면 참고 영상으로 등록돼요',
    limitsReArchitect: '{min}초~{maxMinutes}분 · 최대 {maxMb}MB · {formats}',
    limitsMotionTransfer: '{min}~{max}초 · 최대 {maxMb}MB · {formats}',
    pickFile: '파일 고르기',
    pickLibrary: '보관함에서 고르기',
    openReverse: '샷 표 보며 만들기',
  },
  status: {
    needVideo: '참고 영상을 먼저 넣어 주세요',
    videoRemoved: '참고 영상을 제거했어요',
    undo: '되돌리기',
    switchToEdit: '이 영상에서 일부만 바꾸기',
    backToReference: '움직임 따라가기로 돌아가기',
    gotIt: '알겠어요',
    readAgain: '다시 읽기',
  },
  explainer: {
    label: '{mode} 안내',
    reArchitect: {
      step1: '참고 영상',
      step2: '연출 샷 표',
      step3: '내 에셋으로 새 영상',
      shot1: '0.0–3.2초 · 클로즈업',
      shot2: '3.2–7.5초 · 패닝',
      shot3: '7.5–12.0초 · 와이드',
      mine1: '내 제품',
      mine2: '내 인물',
      mine3: '내 장소',
    },
    motionTransfer: {
      step1: '참고 영상 움직임',
      step2: '내 인물·제품에 입히기',
      step3: '같은 타이밍의 새 영상',
      motionTag: '움직임·타이밍',
    },
  },
};

export type StudioVideoModesCopy = typeof studioVideoModesEn;
