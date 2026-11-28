/**
 * Plain values shared by the server page and its client island. They live in a module without
 * `'use client'` on purpose: a server component that imports a value from a client module receives
 * a client reference, not the value.
 */
export const DEFAULT_DIRECT_ROYALTY_KRW = 1000;
