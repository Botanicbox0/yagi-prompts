/**
 * Binds the tray's references to each model's own reference syntax.
 *
 *  seedream     images in send order: "Figure 1", "Figure 2" …
 *  nano-banana  images in send order: "image 1", "image 2" …
 *  seedance     per kind in send order: "@Image1", "@Video1", "@Audio1" (reference-to-video only)
 *
 * A region edit sends the enlarged crop first, so it is "image 1" / "Figure 1" and the tray's
 * images start at 2. Seedance writes tokens only when the run goes to the reference endpoint: a run
 * whose images are all opening/closing frames goes to image-to-video, which takes no tokens.
 * The caller must send each kind's files in tray order for these numbers to hold.
 */
import { rewriteReferenceMentions, type MentionKind } from './mentions';
import type { EnhanceInput, EnhanceKind, EnhanceReference } from './types';

export type SeedanceReferenceMode = 'text' | 'frames' | 'reference';

export interface BoundReference {
  ref: EnhanceReference;
  /** 1-based place in tray order. */
  position: number;
  /** 1-based place among references of the same kind. */
  ordinal: number;
  /** What the prompt writes for it; null when the model receives no token for it. */
  token: string | null;
  /** How the prompt names it in words when there is no token. */
  name: string;
}

export interface Binding {
  bound: BoundReference[];
  /** Region edit: the token of the crop being edited ("image 1"). */
  editTarget: string | null;
  /** Seedance only. */
  seedanceMode: SeedanceReferenceMode | null;
}

/**
 * Which Seedance endpoint family a video run needs: no references -> text, only opening/closing
 * frames -> frames (image-to-video, no tokens), anything else -> reference (tokens).
 */
export function seedanceReferenceMode(
  kind: EnhanceKind,
  references: readonly Pick<EnhanceReference, 'kind' | 'frame'>[],
): SeedanceReferenceMode {
  // A remix with its video attached is always a reference run. A blueprint remix reaches here without its
  // video (it is only read, never sent) and is decided like any other video run.
  if (kind === 'video_remix' && references.some((r) => r.kind === 'video')) return 'reference';
  if (references.length === 0) return 'text';
  const onlyFrames = references.every((r) => r.kind === 'image' && r.frame !== undefined);
  const starts = references.filter((r) => r.frame === 'start').length;
  const ends = references.filter((r) => r.frame === 'end').length;
  return onlyFrames && starts <= 1 && ends <= 1 ? 'frames' : 'reference';
}

function tokenFor(
  input: Pick<EnhanceInput, 'kind' | 'profile'>,
  ref: EnhanceReference,
  ordinal: number,
  mode: SeedanceReferenceMode | null,
): string | null {
  const offset = input.kind === 'region_edit' ? 1 : 0;
  switch (input.profile) {
    case 'seedream':
      return ref.kind === 'image' ? `Figure ${ordinal + offset}` : null;
    case 'nano-banana':
    case 'gpt-image':
      return ref.kind === 'image' ? `image ${ordinal + offset}` : null;
    case 'seedance': {
      if (mode !== 'reference') return null;
      const word = ref.kind === 'image' ? 'Image' : ref.kind === 'video' ? 'Video' : 'Audio';
      return `@${word}${ordinal}`;
    }
  }
}

function nameFor(ref: EnhanceReference): string {
  if (ref.frame === 'start') return 'the opening frame';
  if (ref.frame === 'end') return 'the closing frame';
  return ref.kind === 'video' ? 'the reference video' : ref.kind === 'audio' ? 'the reference sound' : 'the reference picture';
}

export function bindReferences(input: Pick<EnhanceInput, 'kind' | 'profile' | 'references'>): Binding {
  const ordered = input.references
    .map((ref, at) => ({ ref, at }))
    .sort((a, b) => a.ref.index - b.ref.index || a.at - b.at)
    .map(({ ref }) => ref);
  const mode = input.profile === 'seedance' ? seedanceReferenceMode(input.kind, ordered) : null;
  const seen: Record<EnhanceReference['kind'], number> = { image: 0, video: 0, audio: 0 };
  const bound = ordered.map((ref, i): BoundReference => {
    seen[ref.kind] += 1;
    const ordinal = seen[ref.kind];
    return { ref, position: i + 1, ordinal, token: tokenFor(input, ref, ordinal, mode), name: nameFor(ref) };
  });
  const editTarget =
    input.kind !== 'region_edit' ? null : input.profile === 'seedream' ? 'Figure 1' : 'image 1';
  return { bound, editTarget, seedanceMode: mode };
}

/** The reference a customer mention points at, if it is attached. */
export function resolveMention(
  bound: readonly BoundReference[],
  kind: MentionKind | 'any',
  number: number,
): BoundReference | null {
  if (kind === 'any') return bound[number - 1] ?? null;
  return bound.find((b) => b.ref.kind === kind && b.ordinal === number) ?? null;
}

/** The customer's prompt with "이미지 2" / "@1" rewritten to the model's tokens (or plain names). */
export function mapCustomerMentions(prompt: string, bound: readonly BoundReference[]): string {
  return rewriteReferenceMentions(prompt, (kind, number) => {
    const hit = resolveMention(bound, kind, number);
    return hit ? (hit.token ?? hit.name) : null;
  });
}

/** Tokens a prompt uses, per profile: numbers by kind. */
export function tokensIn(
  profile: EnhanceInput['profile'],
  text: string,
): Array<{ kind: 'image' | 'video' | 'audio'; number: number }> {
  const out: Array<{ kind: 'image' | 'video' | 'audio'; number: number }> = [];
  const re =
    profile === 'seedream'
      ? /\bFigure\s*(\d{1,2})\b/gi
      : profile === 'nano-banana' || profile === 'gpt-image'
        ? /\bimage\s*(\d{1,2})\b/gi
        : /@(Image|Video|Audio)\s?(\d{1,2})\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (profile === 'seedance') {
      const word = (m[1] ?? '').toLowerCase() as 'image' | 'video' | 'audio';
      out.push({ kind: word, number: Number(m[2]) });
    } else {
      out.push({ kind: 'image', number: Number(m[1]) });
    }
  }
  return out;
}

/** Whether a token (e.g. "@Image2", "Figure 1") appears in the text, tolerant of spacing and case. */
export function hasToken(text: string, token: string): boolean {
  const m = /^(@?)([A-Za-z]+)\s?(\d+)$/.exec(token);
  if (!m) return text.includes(token);
  const re = new RegExp(`${m[1]}${m[2]}\\s?${m[3]}(?!\\d)`, 'i');
  return re.test(text);
}
