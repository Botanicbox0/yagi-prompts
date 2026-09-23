"use client";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The two strings the workspace error boundary shows, handed down by the (server) layout in the
 * request's language. The boundary is a client component; passing just these keeps both full
 * dictionaries out of the client bundle.
 */
export interface BrandErrorCopy { title: string; retry: string }
const Copy = createContext<BrandErrorCopy | null>(null);
export function BrandErrorCopyProvider({ copy, children }: { copy: BrandErrorCopy; children: ReactNode }) {
  return <Copy.Provider value={copy}>{children}</Copy.Provider>;
}
export function useBrandErrorCopy(): BrandErrorCopy | null {
  return useContext(Copy);
}
