/**
 * Browser draft storage for admin template creation (`/admin/prompts/new`).
 *
 * Operational report (Dana): "템플릿 업로드 중 잠시 화면이 꺼지거나 뒤로 가기가 되거나 등의
 * 상황에서 임시저장 되게 해줘 템플릿 등록중이던 내용들".
 *
 * A long prompt, Korean translation, source notes, and direct-upload media receipts are
 * written to localStorage on input. Reloading or navigating back restores them without
 * re-uploading large files, and a successful publish clears the draft.
 */

export const PROMPT_DRAFT_KEY = 'twings.admin.prompt-draft.v1';

export interface PromptDraft {
  version: 1;
  savedAt: string;
  title: string;
  titleKo: string;
  promptText: string;
  models: string[];
  useCase: string[];
  sourceUrl: string;
  processMd: string;
  processMdKo: string;
  videoRef?: string;
  posterRef?: string;
  audioRef?: string;
  videoLabel?: string;
  posterLabel?: string;
  audioLabel?: string;
}

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function hasMeaningfulDraft(draft: PromptDraft): boolean {
  return Boolean(
    draft.title.trim() ||
    draft.titleKo.trim() ||
    draft.promptText.trim() ||
    draft.sourceUrl.trim() ||
    draft.processMd.trim() ||
    draft.processMdKo.trim() ||
    draft.videoRef ||
    draft.posterRef ||
    draft.audioRef
  );
}

export function savePromptDraft(store: DraftStore | null, draft: PromptDraft): boolean {
  if (!store) return false;
  try {
    store.setItem(PROMPT_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function loadPromptDraft(store: DraftStore | null): PromptDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PROMPT_DRAFT_KEY);
    if (!raw || raw.length > 128_000) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || data.version !== 1) return null;
    return {
      version: 1,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
      title: typeof data.title === 'string' ? data.title : '',
      titleKo: typeof data.titleKo === 'string' ? data.titleKo : '',
      promptText: typeof data.promptText === 'string' ? data.promptText : '',
      models: Array.isArray(data.models) ? data.models.filter((m: unknown) => typeof m === 'string') : [],
      useCase: Array.isArray(data.useCase) ? data.useCase.filter((u: unknown) => typeof u === 'string') : [],
      sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
      processMd: typeof data.processMd === 'string' ? data.processMd : '',
      processMdKo: typeof data.processMdKo === 'string' ? data.processMdKo : '',
      ...(typeof data.videoRef === 'string' && data.videoRef ? { videoRef: data.videoRef } : {}),
      ...(typeof data.posterRef === 'string' && data.posterRef ? { posterRef: data.posterRef } : {}),
      ...(typeof data.audioRef === 'string' && data.audioRef ? { audioRef: data.audioRef } : {}),
      ...(typeof data.videoLabel === 'string' && data.videoLabel ? { videoLabel: data.videoLabel } : {}),
      ...(typeof data.posterLabel === 'string' && data.posterLabel ? { posterLabel: data.posterLabel } : {}),
      ...(typeof data.audioLabel === 'string' && data.audioLabel ? { audioLabel: data.audioLabel } : {}),
    };
  } catch {
    return null;
  }
}

export function clearPromptDraft(store: DraftStore | null): void {
  if (!store) return;
  try {
    store.removeItem(PROMPT_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function hasPromptDraft(store: DraftStore | null): boolean {
  if (!store) return false;
  return loadPromptDraft(store) !== null;
}
