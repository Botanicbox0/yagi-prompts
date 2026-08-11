/**
 * PLAN §3.5 / §6 — the notification vocabulary, in one dependency-free module.
 *
 * `notification_jobs.kind` is CHECKed to exactly these two values in the database and re-validated
 * by `publish_revision`. Everything downstream — the publish path, the worker's claim predicate,
 * the templates and the unsubscribe token — reads them from here rather than re-spelling strings,
 * so a third kind is one edit plus a migration, not a grep.
 */

export const NOTIFY_KINDS = ['new_playbook', 'playbook_update'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export function isNotifyKind(value: unknown): value is NotifyKind {
  return typeof value === 'string' && (NOTIFY_KINDS as readonly string[]).includes(value);
}

/** §6 `profiles` — one preference column per kind. The worker's claim predicate branches on this. */
export const NOTIFY_TOGGLES = ['notif_new_playbook', 'notif_updates'] as const;
export type NotifyToggle = (typeof NOTIFY_TOGGLES)[number];

export function isNotifyToggle(value: unknown): value is NotifyToggle {
  return typeof value === 'string' && (NOTIFY_TOGGLES as readonly string[]).includes(value);
}

export const TOGGLE_FOR_KIND: Record<NotifyKind, NotifyToggle> = {
  new_playbook: 'notif_new_playbook',
  playbook_update: 'notif_updates',
};

/**
 * Which kind a publication is, derived rather than chosen (§3.5).
 *
 * A "playbook update" is a fact about the playbook — it has been published before — not an option
 * an admin form gets to assert. The admin checkbox only says *whether* to notify; this says what.
 */
export function notifyKindFor(previouslyPublished: boolean): NotifyKind {
  return previouslyPublished ? 'playbook_update' : 'new_playbook';
}
