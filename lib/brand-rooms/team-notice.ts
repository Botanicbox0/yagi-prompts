/**
 * The internal notices the YAGI team gets (Slack, `notifySlackBrandConcierge`) for the two customer moves
 * that reached nobody before (docs/BRAND-ROOMS-FEEDBACK.md §3): a guest's note through a share link, and a
 * brand's approval or change request on a storyboard. The service builds the notice after its write; the
 * route sends it after the answer (`after()`), best effort. Never shown to a customer or a guest.
 */
import { formatTimecode } from '@/lib/brand-studio/review-contracts';
import { reviewAdminPath } from '@/lib/brand-studio/review';
import { roomDeskPath } from './message-contracts';
import { storyboardAdminHref } from './storyboard-contracts';

export interface RoomTeamNotice {
  organizationId: string;
  /** The profile who did it; null for a share link's guest (no account). */
  userId: string | null;
  /** The note or the board (the Slack line's `[msg:]` tag). */
  messageId: string;
  body: string;
  /** Who wrote it when there is no profile row to read (a guest). Already safe for Slack. */
  sender?: { label: string; role: string } | null;
}

/** Hands a notice to the route's sender. Absent in tests and scripts: nothing is sent. */
export type RoomTeamNotify = (notice: RoomTeamNotice) => void;

/**
 * Text someone outside the workspace typed, made inert for Slack: no `<!channel>`, no `<@U…>` mention,
 * no link markup (Slack's own rule: escape `&`, `<`, `>`).
 */
export function slackSafe(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A guest's note on a shared draft. The desk opens on that version when the draft is in a project. */
export function guestNoteNotice(input: {
  organizationId: string;
  projectId: string | null;
  review: { id: string; title: string };
  comment: { id: string; body: string; atMs: number | null; spot: boolean; reply: boolean };
  guestName: string;
}): RoomTeamNotice {
  const { review, comment } = input;
  const head = `[공유 링크 ${comment.reply ? '답글' : '의견'}] ${slackSafe(review.title)}${comment.atMs != null ? ` · ${formatTimecode(comment.atMs)}` : ''}${comment.spot ? ' · 화면 위치 표시' : ''}`;
  const where = input.projectId ? roomDeskPath(input.organizationId, input.projectId, { review: review.id, t: comment.atMs }) : reviewAdminPath(review.id);
  return {
    organizationId: input.organizationId,
    userId: null,
    messageId: comment.id,
    body: [head, slackSafe(comment.body.slice(0, 1200)), `관리자 화면: ${where}`].join('\n'),
    sender: { label: slackSafe(input.guestName.slice(0, 60)), role: '공유 링크 외부인' },
  };
}

const DECISION_WORDS = { approved: '승인', changes_requested: '수정 요청' } as const;

/** A brand's approval or change request on the team's storyboard. */
export function storyboardDecisionNotice(input: {
  organizationId: string;
  userId: string;
  board: { id: string; title: string; version: number };
  status: keyof typeof DECISION_WORDS;
}): RoomTeamNotice {
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    messageId: input.board.id,
    body: [`[스토리보드 ${DECISION_WORDS[input.status]}] ${input.board.title} · v${input.board.version}`, `관리자 화면: ${storyboardAdminHref(input.board.id)}`].join('\n'),
  };
}
