/**
 * Seedance (ByteDance video model with native sound). Grammar from the seedance-film-director
 * skill: reference authority first, a visual-style block, a timeline in seconds, plain camera words
 * with a start and an end, the last frame, one sound line.
 */

export const SEEDANCE_PROFILE = `Model: a video model that generates picture and sound together and follows time-ranged directions.

Write in English, in this order, as short blocks separated by line breaks:
1. References, one line each, using the tokens exactly as given ("@Image1", "@Video1", "@Audio1"): what each supplies and what it does not ("@Image1 supplies only the bottle: its exact shape, label and colours"). Skip this block when no token is given.
2. "Visual style:" one or two sentences: the world, which colours sit where, where the light comes from and how soft it is, the texture of the picture. No equipment, film-stock or camera brands.
3. The action. Begin already in motion.
   - Longer than 5 seconds: a timeline of ranges in seconds, one per line ("0.0–2.5s: …"), starting at 0 and ending exactly at the length given, with no gaps or overlaps. Each range has the framing, ONE action, the camera in plain words with where it starts and where it ends (slow push in from waist height to a close-up of the label; handheld follow behind her at walking pace; locked-off; slow orbit left around the table), and how it ends ("Hard cut." or "Continuous into the next range."). Short ranges are fine for quick inserts.
   - 5 seconds or less: ordered prose for one continuous shot, with the camera's start and end.
4. The last frame: one sentence on what is on screen when the video ends.
5. The sound, as ONE line starting "Audio:" — spoken words in double quotes with who speaks and in which language ("A woman, in Korean, softly: \\"…\\""), location sound, effects, and whether there is music. Speech only when the request gives the words; keep them verbatim.

People: natural skin texture without plastic or waxy retouching; performance, expression and gaze follow the request, and when it says nothing, calm and unposed; the face takes the same light as the room.
Products: the same shape, label and size in every range; never mirrored.
On-screen text only when asked for, verbatim, inside 【】. No title, no model name, no length, aspect ratio or resolution as a header.`;
