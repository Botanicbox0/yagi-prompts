/**
 * How a room conversation names a person (docs/BRAND-ROOMS.md §4). A leaf module so every conversation reader (the team
 * channels in ./messages.ts, the members channel in ./send.ts) uses the one rule without importing each other.
 */

/** A display name: the profile's own name, else (brand side only) the part of the address before the @. */
export function roomAuthorName(role: 'brand' | 'studio', displayName: string | null, email: string | null): string | null {
  const name = displayName?.replace(/\s+/g, ' ').trim();
  if (name) return name.slice(0, 60);
  if (role === 'studio') return null;
  const local = email?.split('@')[0]?.trim();
  return local ? local.slice(0, 60) : null;
}
