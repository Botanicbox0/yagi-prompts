/**
 * Catalog prompt → ModelArk prompt.
 *
 * The catalog's Seedance prompts were written for Higgsfield, whose convention is `@image1`,
 * `@audio1`, `@video1`. ModelArk's convention is positional prose — "Image 1", "Audio 1",
 * "Video 1" — where N is the asset's order among assets of the SAME type in the request body, and
 * the docs are explicit that an asset id must never appear in the prompt. This rewrites one
 * convention into the other and reports which references the prompt makes, so the caller can
 * check that it is actually attaching Image 1 before spending a render on a prompt that asks
 * for it.
 *
 * Pure. No trimming, no "prompt enhancement", no paraphrase: the founder's prompts are the product
 * and this layer is not allowed to have opinions about them.
 */

export interface PromptReferences {
  images: number[];
  audios: number[];
  videos: number[];
}

export interface RewrittenPrompt {
  text: string;
  references: PromptReferences;
}

const HANDLE = /@(image|audio|video)\s*(\d+)/gi;

export function rewriteReferenceHandles(source: string): RewrittenPrompt {
  const seen: PromptReferences = { images: [], audios: [], videos: [] };
  const text = source.replace(HANDLE, (_match, kind: string, digits: string) => {
    const n = Number.parseInt(digits, 10);
    const bucket = kind.toLowerCase() === 'image' ? seen.images : kind.toLowerCase() === 'audio' ? seen.audios : seen.videos;
    if (!bucket.includes(n)) bucket.push(n);
    const label = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
    return `${label} ${n}`;
  });
  for (const bucket of [seen.images, seen.audios, seen.videos]) bucket.sort((a, b) => a - b);
  return { text, references: seen };
}

/**
 * Which references the prompt names that the request does NOT supply. A prompt that says
 * "Audio 1" with no reference_audio attached renders something, bills for it, and is wrong.
 */
export function missingReferences(
  references: PromptReferences,
  attached: { images: number; audios: number; videos: number },
): string[] {
  const missing: string[] = [];
  for (const n of references.images) if (n > attached.images) missing.push(`Image ${n}`);
  for (const n of references.audios) if (n > attached.audios) missing.push(`Audio ${n}`);
  for (const n of references.videos) if (n > attached.videos) missing.push(`Video ${n}`);
  return missing;
}
