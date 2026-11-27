/** The per-kind task block: what this run is, and the lines it must contain. */
import type { StudioAudioMode } from '@/lib/brand-studio/contracts';
import { AMBIENT_SOUND_CLOSE_PHRASE, AMBIENT_SOUND_OPEN_PHRASE, formatRange, KEEP_PHRASES, keepPhrase, type PlannedShot } from '../lines';
import type { Binding } from '../references';
import type { EnhanceInput } from '../types';
import { SEEDANCE_PRODUCT_CONSISTENCY_PHRASE } from './seedance';

export { AMBIENT_SOUND_CLOSE_PHRASE, AMBIENT_SOUND_OPEN_PHRASE, KEEP_PHRASES };

export const IMAGE_TASK_PRODUCT_KEEP_FORMULA = 'keep the exact label, cap, proportions and colours of <token>';
export const IMAGE_TASK_LOGO_PHRASE = 'the mark is reproduced exactly as drawn, at a natural scale';
export const IMAGE_TASK_INTEGRATION_PHRASE =
  'consistent key-light direction, colour temperature, reflections or refraction and contact shadows';

export const REGION_TASK_WIDE_KEEP_TAIL =
  'framing, camera angle, every other object, people and faces, colours, light, shadows, texture, grain and pixel positions';

export function regionTaskWideKeepPhrase(target: string): string {
  return `Keep everything else in ${target} exactly as it is: ${REGION_TASK_WIDE_KEEP_TAIL}`;
}

export const REGION_TASK_CROP_KEEP_TAIL =
  'exact framing, camera angle, object scale, outer silhouette, contours, lighting direction, colour palette, and pixel positions completely unchanged';

export function regionTaskCropKeepPhrase(target: string): string {
  return `Keep ${target}'s ${REGION_TASK_CROP_KEEP_TAIL}`;
}

export const REGION_TASK_CROP_PIXELS_PREFIX = 'keep every surrounding pixel identical to';

export function regionTaskCropPixelsPhrase(target: string): string {
  return `${REGION_TASK_CROP_PIXELS_PREFIX} ${target}`;
}

export const REVISION_EDIT_KEEP_PHRASE =
  'the camera movement, the timing and cuts, the framing, the subjects';

function soundRule(mode: StudioAudioMode): string {
  switch (mode) {
    case 'native':
      return 'Sound: picture, sound and music are generated together. The Audio line names the location sound, the effects and music that fits the mood.';
    case 'ambient':
      return `Sound: no music; music is added later. The Audio line begins "${AMBIENT_SOUND_OPEN_PHRASE}" and ends "${AMBIENT_SOUND_CLOSE_PHRASE}" Write no music anywhere else.`;
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
  // 2026-11-19: a product or logo is bound by naming what to keep, not by re-describing it — the picture
  // already carries it and a second description competes with it [aggregator: Runware Seedream 5.5
  // multi-reference guide; official: BytePlus "reference target"]. Style and place pictures are what words
  // are for: their light, materials and palette are taken over in words [house: 2026-11-14 grounding].
  const first = binding.bound.find((b) => b.token)?.token ?? 'image 1';
  return `Task: a new still image from the request, using the attached images for what each one supplies.
Look at every attached picture ("Picture of ...") alongside the customer's "request", "role", "take" and "leaveOut", and bind each token to what it really shows:
- product: name it with one noun and the trait that tells it apart ("the frosted bottle in ${first}"), then name what to keep as categories: "${IMAGE_TASK_PRODUCT_KEEP_FORMULA}". Do not re-describe its colours, shapes or label text at length; the picture carries them. Leave out its own background and lighting unless asked.
- logo: say where the mark sits and how it meets the surface (printed flat on the curved glass), and that ${IMAGE_TASK_LOGO_PHRASE}.
- person: their face, hair, build and skin come from the picture, never its backdrop, light or colour grade unless the request asks for them: the request sets the scene. Take wardrobe or pose only when asked or listed in "take". The people rules below say how to write skin.
- style / place: describe in concrete words what to take from it: where the key light comes from, how soft the highlights are, where shadows fall, the surface materials, the dominant colours and the setting. Leave out any subject or product shown in it.
- when "role" is null: decide what each picture supplies by comparing what is visibly in it with the request.
Optical integration: unite all kept elements into ONE physical photograph with ${IMAGE_TASK_INTEGRATION_PHRASE} rather than a pasted collage.`;
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
  const wide = input.regionWindow;
  if (wide) {
    return `Task: change one boxed part of an existing picture.${sources}${sourceInspection}
Image 1 (${target}) is the customer's picture (or a wide part of it) at its own size, not a crop. The part to change is the boxed area in the ${wide.where} of ${target}, ${wide.left}-${wide.right}% from the left edge and ${wide.top}-${wide.bottom}% from the top edge; the close-up shows it. The editor gets no box, so name that part by what it visibly is and where it sits in ${target} (for example "the white teapot on the low table at the bottom left") so it is found from your words alone. ${regionTaskWideKeepPhrase(target)}.
Start with "In ${target}, change only <the named part and where it is> into <the change>; do not move or resize anything else." Then say how the changed part must look, then the keep-list.
Never zoom, crop, reframe, extend, rotate or change the aspect. Do not describe or change anything outside the boxed part.`;
  }
  return `Task: change one boxed part of an existing picture.${sources}${sourceInspection}
Image 1 (${target}) is an enlarged crop cut out from a larger photograph, so it may look soft. ${regionTaskCropKeepPhrase(target)}. Never redraw, enlarge, or re-shape the surrounding object (never invent curvature or new geometry). Apply ONLY the requested local change, then ${regionTaskCropPixelsPhrase(target)}.
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
Kept from the blueprint: ${kept}. For each kept item carry the blueprint's words over in plain language; rewrite only what the change replaces, and keep a replaced product ${SEEDANCE_PRODUCT_CONSISTENCY_PHRASE}.
${soundRule(audio)}`;
}

function remixTask(input: EnhanceInput, binding: Binding, seconds: number | null, shots: readonly PlannedShot[], shotsInUserTurn = false): string {
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
  // The shot table is read from the customer's video (and the customer may have edited it): with the prompt
  // guard on (lib/ai-guard) it stays in the user turn as "video.shots" and these rules only point at it.
  const table = shots.length
    ? `\nThe reference's shots, fitted to the new length${shotsInUserTurn ? ', are in "video.shots".' : `:\n${shotTable(shots)}`}\n${timing ? 'Use exactly these ranges for the timeline.' : 'Use them as a guide for the timeline.'} For each kept item, carry the range's camera, framing or action over in plain words; rewrite only what the change replaces.`
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

/** The customer was asked what an unclear request meant and answered (revise.plan, revision/clarify.ts). */
function clarifiedRule(): string {
  return '"revision.clarified" is a question the customer was asked because the request could be read two ways, and the answer they chose. The answer states what they meant: where it and the request\'s wording differ or the wording is vague, follow the answer. Write the change as if the request had said it plainly. A request in "revision.history" may end with a short answer in parentheses: that is what that request meant. Never mention a question, an answer or a choice in the prompt.';
}

/**
 * A version made from the revise conversation (lib/brand-studio/revision/talk.ts): the settled sheet is the
 * request, and the run's length is fixed by the studio, so the writer never states another one.
 */
function sheetRule(mode: 'edit' | 'reshoot', seconds: number | null): string {
  const length =
    mode === 'edit' || seconds === null
      ? 'The new clip keeps the length of the video exactly. Never write a length, and never say in "notes" that the length changes.'
      : `The new clip is exactly ${seconds} seconds long: lay the timing marks from 0.0s to ${seconds.toFixed(1)}s (stretch the earlier ones to fit). Never write any other length, and never say in "notes" that it has any other length.`;
  return `"revision.sheet" is the request, settled with the customer in a conversation: apply every item of "sheet.change"; keep every item of "sheet.keep" exactly as it is; make sure nothing in "sheet.exclude" appears. Corrections are already applied in it: where the request's lines and the sheet differ, follow the sheet.
${length}`;
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
  const marks =
    (revision.marks?.length ? `\n${marksRule(revision.mode)}` : '') +
    (revision.materials?.length ? `\n${materialsRule()}` : '') +
    (revision.clarified || revision.history.some((h) => /\)\s*$/.test(h)) ? `\n${clarifiedRule()}` : '') +
    (revision.sheet ? `\n${sheetRule(revision.mode, revision.seconds ?? null)}` : '');
  if (revision.mode === 'edit') {
    const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
    const pictures = binding.bound.some((b) => b.ref.kind === 'image' && b.token)
      ? ' Bind each attached image by its token for what it supplies to the change.'
      : '';
    return `Task: the next version of a generated clip. ${ref} is version ${previous} of the clip; it was generated from the prompt in "revision.madeWith".${hasHistory ? ` The changes in "revision.history" were made after that and are already visible in ${ref}: they stay.` : ''}
Write an edit instruction for ${ref} that applies ONLY the request. Open with: "In ${ref}, change only <the change>; everything else stays as it is." Name the subject with the same words "revision.madeWith" uses for it, so the model finds it in the video.${pictures}
Then say plainly that ${REVISION_EDIT_KEEP_PHRASE} and everything the request does not mention stay exactly as they are in ${ref}. No new timeline, no new shots, no new camera moves, no visual-style block.${marks}
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

/** Output phrases the active task block tells the model to write into the prompt. */
export function taskAllowPhrases(input: EnhanceInput, binding: Binding): string[] {
  const out: string[] = [];
  if (input.revision && (input.kind === 'video' || input.kind === 'video_remix')) {
    if (input.revision.mode === 'edit') out.push(REVISION_EDIT_KEEP_PHRASE);
    if (input.video?.audio === 'ambient') out.push(AMBIENT_SOUND_OPEN_PHRASE, AMBIENT_SOUND_CLOSE_PHRASE);
    return out;
  }
  switch (input.kind) {
    case 'image':
      if (binding.bound.some((b) => b.token)) {
        out.push(IMAGE_TASK_PRODUCT_KEEP_FORMULA, IMAGE_TASK_LOGO_PHRASE, IMAGE_TASK_INTEGRATION_PHRASE);
      }
      return out;
    case 'region_edit': {
      const target = binding.editTarget ?? 'image 1';
      out.push(
        ...(input.regionWindow
          ? [regionTaskWideKeepPhrase(target)]
          : [regionTaskCropKeepPhrase(target), regionTaskCropPixelsPhrase(target)]),
      );
      return out;
    }
    case 'video':
      if (input.video?.audio === 'ambient') out.push(AMBIENT_SOUND_OPEN_PHRASE, AMBIENT_SOUND_CLOSE_PHRASE);
      return out;
    case 'video_remix':
      if (input.video?.method !== 'edit' && input.video?.keep?.includes('look')) {
        out.push(KEEP_PHRASES.look);
      }
      if (input.video?.audio === 'ambient') out.push(AMBIENT_SOUND_OPEN_PHRASE, AMBIENT_SOUND_CLOSE_PHRASE);
      return out;
  }
}

export function taskBlock(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
  options: { shotsInUserTurn?: boolean } = {},
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
      return remixTask(input, binding, seconds, shots, options.shotsInUserTurn);
  }
}
