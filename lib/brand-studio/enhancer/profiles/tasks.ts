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
  return `Task: a new still image from the request${attached ? ', using the attached images for what each one supplies' : ''}.`;
}

function regionTask(input: EnhanceInput, binding: Binding): string {
  const target = binding.editTarget ?? 'image 1';
  const others = binding.bound.filter((b) => b.token).map((b) => b.token as string);
  const sources = others.length
    ? ` ${others.join(', ')} ${others.length === 1 ? 'is a source' : 'are sources'} for the change (a logo, a product, a texture); take only what the change needs from ${others.length === 1 ? 'it' : 'them'}.`
    : '';
  const opening =
    input.profile === 'seedream'
      ? `"In ${target}, change only <the change>; do not move or resize anything else."`
      : `"Using ${target}, change only <the change>; do not move or resize anything else."`;
  return `Task: change one boxed part of an existing picture. ${target} is that part, cut out and enlarged. The result is pasted back over the same spot, so it must keep ${target}'s framing, scale, perspective and position exactly.${sources}
Start with ${opening} Then say how the changed part must look, then the keep-list (light direction, colour, shadows, texture and grain of ${target}).
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

function remixTask(input: EnhanceInput, binding: Binding, seconds: number | null, shots: readonly PlannedShot[]): string {
  const video = input.video;
  const audio = video?.audio ?? 'native';
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

export function taskBlock(
  input: EnhanceInput,
  binding: Binding,
  seconds: number | null,
  shots: readonly PlannedShot[],
): string {
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
