/**
 * Seedance (ByteDance video model with native sound). Grammar from the seedance-film-director
 * skill: reference authority first, a visual-style block, a timeline in seconds, plain camera words
 * with a start and an end, the last frame, one sound line.
 */

export const SEEDANCE_PROFILE = `Model: a video model that generates picture and sound together and follows time-ranged directions.

Write in English, in this order, as short blocks separated by line breaks:
1. Reference authority, one line per attached reference using the tokens exactly as given ("@Image1", "@Video1", "@Audio1"): what each supplies and what it does not ("@Image1 supplies only the bottle: its exact shape, label and colours"). Skip this block when no token is given.
2. "Visual style:" one or two sentences: concrete #Hex palette roles (shadow floor, primary surfaces/wardrobe, key accent), motivated light direction with grounded ambient shadow floor and color spill (never pasted-on or flat front-lit), and natural lens/material texture. No equipment, film-stock or camera brands.
3. The action. Begin already in motion, writing self-contained visible action, camera and lighting prose (never write "same as original video").
   - Longer than 5 seconds: a timeline of ranges in seconds, one per line ("0.0–2.5s: …"), starting at 0 and ending exactly at the length given, with no gaps or overlaps. Alternate off-axis eyelines and camera angles across cuts (18° / 45° / 90° / OTS; avoid static front-on passport stares). Each range has the framing, ONE action, the camera in plain words with where it starts and where it ends (slow push in from waist height to a close-up of the label; handheld follow behind her at walking pace; locked-off; slow orbit left around the table), and how it hands over ("Hard cut.", "Match cut on …", or "Continuous into the next range."). Short ranges are fine for quick inserts.
   - 5 seconds or less: ordered prose for one continuous shot, with off-axis eyeline and the camera's start and end.
4. The last frame: one sentence on what is on screen when the video ends.
5. The sound, as ONE line starting "Audio:" — spoken words in double quotes with who speaks and in which language ("A woman, in Korean, softly: \\"…\\""), diegetic Foley, room ambience, effects, and whether there is music. Speech only when the request gives the words; keep them verbatim.

People: natural skin texture faithful to @Image1 (when a person reference is attached), zero plastic/waxy beauty-filter glare — never write "glass-skin", "poreless porcelain" or "dewy highlighter"; performance, expression and off-axis gaze follow the request, and when it says nothing, calm and unposed; the face matches the ambient shadow floor and color spill of the room.
Products: the same shape, label and size in every range; never mirrored.
On-screen text only when asked for, verbatim, inside 【】. Omit all redundant headers: never write "Create a Seedance video", model names, duration, aspect ratio, resolution or FPS headers.`;
