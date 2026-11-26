'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicRecipe } from '@/lib/recipes/public';

export interface RecipeAccessState {
  unlockedRecipe: PublicRecipe | null;
  loaded: boolean;
}

const RecipeAccessContext = createContext<RecipeAccessState | null>(null);

/**
 * Shares the one per-page `/api/renders/access` recipe fetch across `HowItWasMade`,
 * `RecipeActions`, and `RecipeClipsSection` so adding `#clips` never doubles the request.
 */
export function RecipeAccessProvider({
  accessEndpoint,
  initialUnlocked = null,
  children,
}: {
  accessEndpoint: string | null;
  initialUnlocked?: PublicRecipe | null;
  children: ReactNode;
}) {
  const [fetched, setFetched] = useState<{ endpoint: string; recipe: PublicRecipe | null } | null>(null);

  useEffect(() => {
    if (initialUnlocked !== null || !accessEndpoint) return;
    let cancelled = false;
    fetch(accessEndpoint, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; recipe?: PublicRecipe | null } | null) => {
        if (cancelled) return;
        setFetched({ endpoint: accessEndpoint, recipe: data?.signedIn && data.recipe ? data.recipe : null });
      })
      .catch(() => {
        if (!cancelled) setFetched({ endpoint: accessEndpoint, recipe: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accessEndpoint, initialUnlocked]);

  const matched = accessEndpoint !== null && fetched?.endpoint === accessEndpoint;
  const value: RecipeAccessState = {
    unlockedRecipe: initialUnlocked ?? (matched ? fetched.recipe : null),
    loaded: initialUnlocked !== null || accessEndpoint === null || matched,
  };

  return <RecipeAccessContext.Provider value={value}>{children}</RecipeAccessContext.Provider>;
}

export function useRecipeAccess(): RecipeAccessState | null {
  return useContext(RecipeAccessContext);
}
