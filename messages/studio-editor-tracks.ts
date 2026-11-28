/**
 * Editing studio v2 — parallel video tracks draft dictionary (slice E-T, Batch T1).
 *
 * Kept separate from `messages/studio-editor.ts` so the existing editor dictionary remains byte-identical
 * while `BRAND_STUDIO_EDITOR_V2_TRACKS` is closed. Korean wording: local Gemma 2-pass, then fact check (2026-11-28).
 */

export const studioEditorTracksEn = {
  toolbar: {
    linkage: 'Linkage',
    linkageNote: 'Moves or deletes the kinds checked in Linkage settings together with their main cut',
    linkageNoneActive: 'Nothing is linked right now. Pick kinds in Linkage settings.',
    linkageSettings: 'Linkage settings',
    linkageSettingsNote: 'When linkage is on, checked kinds move or are deleted together with their main cut.',
    linkageKindOverlay: 'Overlay',
    snap: 'Auto snap',
    snapNote: 'Snaps clip edges to other clips, the playhead, and time 0',
  },
  lanes: {
    overlay: 'Overlay {n}',
    newTrackHint: 'Drop here to add a new overlay track',
    overlayCut: 'Overlay {track} · Clip {number}',
  },
  actions: {
    moveUp: 'Move up a track',
    moveDown: 'Move down a track',
    moveDownToMainTip: 'Moves into the main track between cuts',
    removeClip: 'Remove clip',
    splitAll: 'Split all tracks',
    toggleLinkage: 'Toggle linkage',
    toggleSnap: 'Toggle auto snap',
  },
  toast: {
    trackLimit: 'You can use up to {max} overlay tracks right now.',
    overlayLimit: 'You can place up to {max} clips on overlay tracks right now.',
    cannotLiftLast: 'Keep at least one clip on the main track.',
    cannotDropBelowMain: 'Video clips cannot be placed below the main track.',
    splitAllNo: 'There is no clip to split at the playhead.',
  },
  preview: {
    unmuteOverlay: 'Turn sound on',
  },
  export: {
    blocked: 'Overlay-track clips cannot be exported yet.',
    contentsOverlays: '{count} overlay-track clip(s)',
  },
  chat: {
    overlaysMoved: '{n} overlay-track clip(s) move along with this edit',
    overlaysDeleted: '{n} overlay-track clip(s) are removed along with this edit',
    overlaysExtendPastMain: 'Overlay-track clips continue until {time}',
    upperOnlyNote: 'Chat edits only the main track. Edit overlay-track clips directly on the timeline.',
  },
  classic: {
    overlaysNote: 'Overlay-track clips may look different in the previous editor.',
    renderBlocked: 'This film has overlay-track clips from the new editing studio and cannot be exported here.',
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type StudioEditorTracksCopy = Widen<typeof studioEditorTracksEn>;

export const studioEditorTracksKo: StudioEditorTracksCopy = {
  toolbar: {
    linkage: '연동',
    linkageNote: '메인 컷을 옮기거나 지우면 연동 설정에서 켠 항목도 함께 움직이거나 지워져요',
    linkageNoneActive: '현재 연동된 항목이 없어요. 연동 설정에서 선택해 주세요',
    linkageSettings: '연동 설정',
    linkageSettingsNote: '연동을 켜면 선택한 항목이 메인 컷과 함께 움직이거나 지워져요.',
    linkageKindOverlay: '오버레이',
    snap: '자동 스냅',
    snapNote: '클립 끝을 다른 클립, 재생 위치, 시작점에 딱 붙여요',
  },
  lanes: {
    overlay: '오버레이 {n}',
    newTrackHint: '여기에 놓으면 새 오버레이 트랙이 추가돼요',
    overlayCut: '오버레이 트랙 {track} · 클립 {number}',
  },
  actions: {
    moveUp: '위 트랙으로 이동',
    moveDown: '아래 트랙으로 이동',
    moveDownToMainTip: '메인 트랙의 컷 사이로 이동해요',
    removeClip: '클립 지우기',
    splitAll: '모든 트랙 자르기',
    toggleLinkage: '연동 켜고 끄기',
    toggleSnap: '자동 스냅 켜고 끄기',
  },
  toast: {
    trackLimit: '오버레이 트랙은 최대 {max}개까지 만들 수 있어요.',
    overlayLimit: '오버레이 트랙에는 클립을 최대 {max}개까지 올릴 수 있어요.',
    cannotLiftLast: '메인 트랙에는 컷이 하나 이상 남아 있어야 해요.',
    cannotDropBelowMain: '영상 클립은 메인 트랙 아래에 놓을 수 없어요.',
    splitAllNo: '재생 위치에 자를 수 있는 클립이 없어요.',
  },
  preview: {
    unmuteOverlay: '소리 켜기',
  },
  export: {
    blocked: '오버레이 트랙 클립은 아직 내보낼 수 없어요.',
    contentsOverlays: '오버레이 트랙 클립 {count}개',
  },
  chat: {
    overlaysMoved: '오버레이 트랙 클립 {n}개가 함께 이동해요',
    overlaysDeleted: '오버레이 트랙 클립 {n}개가 함께 삭제돼요',
    overlaysExtendPastMain: '오버레이 트랙 클립이 {time}까지 이어져요',
    upperOnlyNote: '말로 편집은 메인 트랙만 고칠 수 있어요. 오버레이 트랙 클립은 타임라인에서 직접 수정해 주세요.',
  },
  classic: {
    overlaysNote: '오버레이 트랙 클립은 예전 편집기에서 다르게 보일 수 있어요.',
    renderBlocked: '이 영상에는 새 편집 스튜디오의 오버레이 트랙 클립이 있어 여기서는 내보낼 수 없어요.',
  },
};
