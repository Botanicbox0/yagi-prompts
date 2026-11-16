/** The per-kind task block: what this run is, and the lines it must contain. */
import type { StudioAudioMode } from '@/lib/brand-studio/contracts';
import { formatRange, keepPhrase, type PlannedShot } from '../lines';
import type { Binding } from '../references';
import type { EnhanceInput } from '../types';

function soundRule(mode: StudioAudioMode): string {
  switch (mode) {
    case 'native':
      return 'Sound: picture, sound and music are generated together. The Audio line names the location sound, the effects and music that fits the mood.';
    case 'ambient':
      return 'Sound: no music; music is added later. The Audio line begins "Audio: no music, only location sound and effects" and ends "No background music, score, melody or beat." Write no music anywhere else.';
    case 'silent':
      return 'Sound: none. Write no Audio line and do not describe sounds.';
  }
}

function shotTable(shots: readonly PlannedShot[]): string {
  return shots
    .map((s) => `${formatRange(s.start, s.end)} | framing: ${s.framing} | camera: ${s.camera} | action: ${s.action}`)
    .join('\n');
}

function imageTask(input: EnhanceInput, binding: Binding): string {
  const attached = binding.bound.some((b) => b.token);
  if (!attached) {
    return 'Task: a new still image from the request.';
  }
  return `Task: a new still image from the request, using the attached images for what each one supplies.
Inspect every attached picture ("Picture of ...") directly alongside the customer's "request", "role", "take" and "leaveOut". Never write generic blind placeholders when pixels are attached; pair each reference token with concrete visible traits from its picture:
- product: describe its actual visible silhouette, material and opacity (such as clear, frosted or tinted glass, matte tube, brushed metal, paperboard), cap or closure geometry, finish and surface colours, while keeping the exact label, proportions and colours of the token; leave out its original background and lighting unless asked.
- logo: describe visible mark shape, colour contrast and natural surface placement, and require the exact mark to stay unredrawn, unmirrored, un-restyled and properly scaled.
- model: lock the visible facial structure, hairstyle, build and natural matte skin texture (without plastic or waxy retouching); take wardrobe or pose only when asked or listed in "take".
- style / location: extract visible key-light direction, highlight softness, shadow fall, surface materials and dominant colour palette from the picture, while leaving out any unrequested subject or product shown in it.
- when "role" is null: infer what each picture supplies by comparing what is visibly inside the picture with the customer's request.
Optical integration: unite all kept elements into ONE physical photograph with consistent key-light direction, colour temperature, surface reflections or refraction and contact shadows rather than a pasted collage.`;
}

function regionTask(input: EnhanceInput, binding: Binding): string {
  const target = binding.editTarget ?? 'image 1';
  const others = binding.bound.filter((b) => b.token).map((b) => b.token as string);
  const sources = others.length
    ? ` ${others.join(', ')} ${others.length === 1 ? 'is a source' : 'are sources'} for the change (a logo, a product, a person, a texture); take only what the change needs from ${others.length === 1 ? 'it' : 'them'}.`
    : '';
  const sourceInspection = others.length
    ? ` Inspect both ${target} (local surface curvature, angle, light direction and grain) and ${others.join(', ')} (exact visible mark, material finish and colours) so the change conforms to ${target}'s perspective, shading and contact shadows.`
    : '';
  const opening =
    input.profile === 'seedream'
      ? `"In ${target}, change only <the change>; do not move or resize anything else."`
      : `"Using ${target}, change only <the change>; do not move or resize anything else."`;
  return `Task: change one boxed part of an existing picture.${sources}${sourceInspection}
Image 1 (${target}) is an enlarged crop cut out from a larger photograph, so it may look soft. Keep ${target}'s exact framing, camera angle, object scale, outer silhouette, contours, lighting direction, colour palette, and pixel positions completely unchanged. Never redraw, enlarge, or re-shape the surrounding object (never invent curvature or new geometry). Apply ONLY the requested local change, then keep every surrounding pixel identical to ${target}.
Start with ${opening} Then say how the changed part must look, then the keep-list (exact object scale, outer silhouette, contours, light direction, colour, shadows, texture, grain and pixel positions of ${target}).
Never zoom, crop, reframe, extend, rotate or change the aspect. Do not describe or change anything outside the change.`;
}

function lengthRule(seconds: number | null): string {
  if (seconds === null) return 'Length: not fixed; write ordered prose for one continuous shot.';
  return seconds > 5
    ? `Length: ${seconds} seconds. Write the timeline from 0.0s to ${seconds.toFixed(1)}s.`
    : `Length: ${seconds} seconds. Write ordered prose for one continuous shot.`;
}

function videoTask(input: EnhanceInput, binding: Binding, seconds: number | null): string {
  const audio = input.video?.audio ?? 'native';
  const frames = binding.bound.filter((b) => b.ref.frame);
  let refs: string;
  if (binding.seedanceMode === 'text') {
    refs = 'Nothing is attached: write no reference tokens.';
  } else if (binding.seedanceMode === 'frames') {
    const end = frames.some((b) => b.ref.frame === 'end');
    refs = `The opening frame${end ? ' and the closing frame are' : ' is'} supplied as pictures without tokens: write no tokens. Describe the motion that starts from the opening frame instead of describing the picture again${end ? ', and end on what the closing frame shows' : ''}.`;
  } else {
    refs = 'Use the attached references by their tokens.';
    if (frames.length) refs += ` ${frames.map((b) => `${b.token} is the ${b.ref.frame === 'start' ? 'opening' : 'closing'} frame.`).join(' ')}`;
  }
  return `Task: a new video from the request. ${refs}
${lengthRule(seconds)}
${soundRule(audio)}`;
}

/**
 * A remake written from the reading alone (docs/BRAND-STUDIO-V3.md §6). The blueprint itself travels in
 * the user turn ("video.shots", "video.reference"), as the customer may have edited it; these rules only
 * say how to write it out.
 */
function blueprintTask(input: EnhanceInput, binding: Binding, seconds: number | null, shots: readonly PlannedShot[]): string {
  const video = input.video;
  const audio = video?.audio ?? 'native';
  const keep = new Set(video?.keep ?? []);
  const kept = keepPhrase(video?.keep) || 'nothing in particular';
  const changeLine = video?.change?.trim()
    ? 'What to replace is given in "video.change"; the request may add to it.'
    : 'Nothing is replaced unless the request says so: remake the blueprint as it is.';
  let refs: string;
  if (binding.seedanceMode === 'reference') refs = 'Attached pictures are named by their tokens; use them for what each one supplies.';
  else if (binding.seedanceMode === 'frames') refs = 'The opening (and any closing) frame is supplied as a picture without a token: write no tokens, start from it and move on.';
  else refs = 'Nothing is attached: write no reference tokens.';
  const length = seconds ? `${seconds.toFixed(1)}s` : 'the full length';
  return `Task: remake a reference video from its blueprint alone. The video itself is NOT attached and the generator never sees it, so write every subject, move and handover out in words. Never mention a reference video, an original or a video token.
${changeLine}
${refs}
The blueprint: "video.shots" are the ranges, already fitted to the new length (framing, action, camera, and, when read, "transition" and "move" with travel / turn / zoom); "video.reference" has the look, the sound, the subjects with their counts and the setting.
Write, in this order:
1. One line per attached picture, if any: what it supplies and what it does not.
2. "Visual style:" one or two sentences: the world, where the light comes from and how soft it is, which colours sit where, the texture of the picture.${keep.has('look') ? ' Take it from the blueprint\'s look and setting.' : ' The look is not kept: take the world from the request, the change and the brand, not from the blueprint.'}
3. "On screen:" each subject once with its count ("one woman in a white shirt; two glass bottles"). Keep those counts in every range. A replaced subject takes the place and the count of the one it replaces unless the change says otherwise.
4. The timeline, one line per range, using exactly the ${shots.length || 'given'} ranges in "video.shots" from 0.0s to ${length}, with no gaps or overlaps, even when it is five seconds or shorter. Each line: the framing, ONE action, then "Camera —" with travel (the camera body moving through space: push in, pull back, track, crane, orbit, handheld follow, or none), pan/tilt (turning in place, or none) and zoom (the lens only, or none) as three separate parts, each with where it starts and where it ends. End every line except the last with its handover: "Hard cut.", "Continuous into the next range, no cut." or the named transition and what drives it.
5. "Last frame:" one sentence on what is on screen when the video ends.
6. The sound line.
Kept from the blueprint: ${kept}. For each kept item carry the blueprint's words over in plain language; rewrite only what the change replaces, and keep a replaced product the same shape, label and size in every range.
${soundRule(audio)}`;
}

function remixTask(input: EnhanceInput, binding: Binding, seconds: number | null, shots: readonly PlannedShot[]): string {
  const video = input.video;
  const audio = video?.audio ?? 'native';
  if (video?.method === 'blueprint') return blueprintTask(input, binding, seconds, shots);
  const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
  // The customer's words stay in the user turn (`video.change`, `request`), never in these rules.
  const changeLine = video?.change?.trim()
    ? 'The change is given in "video.change"; the request may add to it.'
    : 'The change is in the request.';
  if (video?.method === 'edit') {
    return `Task: edit the reference video ${ref} itself. It keeps its length, its cuts, its camera and everything the change does not name.
${changeLine}
Open with: "In ${ref}, change only <the change>; everything else stays as it is." Then, only if it helps, one or two sentences on how the new element looks (bind the attached images) and in which ranges it appears. No new timeline, no new shots, no new camera moves, no visual-style block.
${soundRule(audio)}`;
  }
  const kept = keepPhrase(video?.keep) || 'its overall structure';
  const timing = video?.keep?.includes('timing');
  const table = shots.length
    ? `\nThe reference's shots, fitted to the new length:\n${shotTable(shots)}\n${timing ? 'Use exactly these ranges for the timeline.' : 'Use them as a guide for the timeline.'} For each kept item, carry the range's camera, framing or action over in plain words; rewrite only what the change replaces.`
    : '';
  return `Task: a new video that follows the reference video ${ref} for what is kept and replaces what the change asks for.
${changeLine}
Open with one line in this form: "Follow ${ref} for ${kept}; replace <what> with <what, from the image token when one is given>; keep <what else must stay>." Then the visual style, the action, the last frame and the sound as usual.${table}
${lengthRule(seconds)}
${soundRule(audio)}`;
}

/** ①②③ in a revision request: spots the customer pointed at (lib/brand-studio/enhancer/marks.ts). */
function marksRule(mode: 'edit' | 'reshoot'): string {
  const words = mode === 'edit' ? ' (for an edit, in the words that find it in the video)' : '';
  return `①, ② and ③ in the request are marks the customer placed on the clip: mark n is "revision.marks[n-1]", whose "what" says what it is on and "time" the second it was placed at. Wherever the request uses a mark, write that description instead${words}. When "what" is null, describe the thing by where it is in the frame at that second (use "x","y" as a rough position: left / centre / right, top / middle / bottom). Never write ①②③, the word mark, coordinates or a ring in the prompt.`;
}

/** Material the customer attached to show what they mean, already read into notes (revision/material.ts). */
function materialsRule(): string {
  return '"revision.materials" are notes on videos the customer attached to show what they mean (a texture, a movement, a look). The video model never receives those videos. Take from each note only what the request needs and write it into the change as plain, concrete description: how it looks, how it moves and how fast, how light sits on it. Never mention a reference video, attached material or notes in the prompt, and never write a token for one.';
}

/**
 * A new version of a generated clip (lib/brand-studio/revision). The earlier prompt and requests travel
 * in the user turn ("revision.madeWith", "revision.history"); these rules say what to do with them.
 */
function revisionTask(input: EnhanceInput, binding: Binding): string {
  const revision = input.revision!;
  const audio = input.video?.audio ?? 'native';
  const previous = Math.max(1, revision.version - 1);
  const hasHistory = revision.history.length > 0;
  const never = 'Never mention versions, an earlier prompt, earlier requests or this history in the prompt.';
  const marks = (revision.marks?.length ? `\n${marksRule(revision.mode)}` : '') + (revision.materials?.length ? `\n${materialsRule()}` : '');
  if (revision.mode === 'edit') {
    const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
    const pictures = binding.bound.some((b) => b.ref.kind === 'image' && b.token)
      ? ' Bind each attached image by its token for what it supplies to the change.'
      : '';
    return `Task: the next version of a generated clip. ${ref} is version ${previous} of the clip; it was generated from the prompt in "revision.madeWith".${hasHistory ? ` The changes in "revision.history" were made after that and are already visible in ${ref}: they stay.` : ''}
Write an edit instruction for ${ref} that applies ONLY the request. Open with: "In ${ref}, change only <the change>; everything else stays as it is." Name the subject with the same words "revision.madeWith" uses for it, so the model finds it in the video.${pictures}
Then say plainly that the camera movement, the timing and cuts, the framing, the subjects and everything the request does not mention stay exactly as they are in ${ref}. No new timeline, no new shots, no new camera moves, no visual-style block.${marks}
${never}
${soundRule(audio)}`;
  }
  return `Task: make a generated clip again with changes. "revision.madeWith" is the complete prompt the clip was generated from.
Rewrite it so it applies ${hasHistory ? 'each request in "revision.history" in order (oldest first), and then the request' : 'the request'}. Change only the sentences those requests touch; keep every other sentence, their order, the timing marks and the reference tokens word for word. A later request wins over an earlier one where they disagree.
Pictures attached for the requests are listed in "references" after the ones "revision.madeWith" already uses: bind each by its token (the next free numbers) where its request applies.
Output the complete prompt, not a list of changes.${marks}
${never}
${soundRule(audio)}`;
}

export function taskBlock(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
): string {
  if (input.revision && (input.kind === 'video' || input.kind === 'video_remix')) return revisionTask(input, binding);
  switch (input.kind) {
    case 'image':
      return imageTask(input, binding);
    case 'region_edit':
      return regionTask(input, binding);
    case 'video':
      return videoTask(input, binding, seconds);
    case 'video_remix':
      return remixTask(input, binding, seconds, shots);
  }
}
