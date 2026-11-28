'use client';

import { useSyncExternalStore } from 'react';
import {
  makerSessionSnapshot,
  serverMakerSessionSnapshot,
  subscribeMakerSession,
} from '@/lib/makers/session-store';

function useIsActiveMakerOwner(handle: string): boolean {
  const session = useSyncExternalStore(
    subscribeMakerSession,
    makerSessionSnapshot,
    serverMakerSessionSnapshot,
  );
  return Boolean(session.signedIn && session.active && session.handle && session.handle === handle);
}

const QUIET_OWNER_ACTION_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-[#09090B]/15 bg-[#FFFFFF] px-4 text-sm font-medium whitespace-nowrap text-[#09090B] transition-colors hover:border-[#09090B]/30 hover:bg-[#F4F4F5]';

export function MakerProfileOwnerActions({
  handle,
  writeHref,
  editHref,
  labels,
}: {
  handle: string;
  writeHref: string;
  editHref: string;
  labels: {
    writePost: string;
    editProfile: string;
  };
}) {
  if (!useIsActiveMakerOwner(handle)) return null;

  return (
    <>
      <a href={writeHref} data-maker-owner-write className={QUIET_OWNER_ACTION_CLASS}>
        {labels.writePost}
      </a>
      <a href={editHref} data-maker-owner-edit className={QUIET_OWNER_ACTION_CLASS}>
        {labels.editProfile}
      </a>
    </>
  );
}

export function MakerBlogEmptyOwnerCta({
  handle,
  writeHref,
  label,
}: {
  handle: string;
  writeHref: string;
  label: string;
}) {
  if (!useIsActiveMakerOwner(handle)) return null;

  return (
    <div className="mt-5">
      <a
        href={writeHref}
        data-maker-owner-first-post
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF58AE] px-6 text-sm font-semibold whitespace-nowrap text-[#09090B] transition-colors hover:bg-[#FF389F]"
      >
        {label}
      </a>
    </div>
  );
}
