import { stripTemplateLockBlocks } from './locks';
import { stripTemplateStylingBlocks } from './styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — a prompt as a PERSON reads or copies it: the `Template styling:` and `Template locks:`
 * blocks are instructions to the studio's compiler, not part of the recipe a buyer or a member is shown, so every
 * displayed or copied prompt goes without them. A text without either header comes back byte-identical (the strip
 * helpers return their input untouched when the header is absent). Stored text, and everything the compiler reads, keep
 * both blocks.
 *
 * Client-safe: the two strip helpers are pure string functions.
 */
export function withoutTemplateDeclarations(text: string): string {
  return stripTemplateLockBlocks(stripTemplateStylingBlocks(text));
}
