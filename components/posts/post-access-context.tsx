'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PostPromptBlock } from '@/lib/posts/schema';

export interface PostAccessState {
  prompts: PostPromptBlock[] | null;
  loaded: boolean;
}

const PostAccessContext = createContext<PostAccessState | null>(null);

/**
 * Performs the single per-page `/api/posts/access` request on mount so any number of prompt cards
 * inside a blog post unlock together without duplicating requests.
 */
export function PostAccessProvider({
  accessEndpoint,
  children,
}: {
  accessEndpoint: string | null;
  children: ReactNode;
}) {
  const [fetched, setFetched] = useState<{ endpoint: string; prompts: PostPromptBlock[] | null } | null>(null);

  useEffect(() => {
    if (!accessEndpoint) return;
    let cancelled = false;
    fetch(accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; prompts?: PostPromptBlock[] | null } | null) => {
        if (cancelled) return;
        setFetched({
          endpoint: accessEndpoint,
          prompts: data?.signedIn && Array.isArray(data.prompts) ? data.prompts : null,
        });
      })
      .catch(() => {
        if (!cancelled) setFetched({ endpoint: accessEndpoint, prompts: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accessEndpoint]);

  const matched = accessEndpoint !== null && fetched?.endpoint === accessEndpoint;
  const value: PostAccessState = {
    prompts: matched ? fetched.prompts : null,
    loaded: accessEndpoint === null || matched,
  };

  return <PostAccessContext.Provider value={value}>{children}</PostAccessContext.Provider>;
}

export function usePostAccess(): PostAccessState | null {
  return useContext(PostAccessContext);
}
