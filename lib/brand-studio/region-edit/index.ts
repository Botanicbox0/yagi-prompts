/**
 * Region edit (docs/BRAND-STUDIO-V2.md §8.3). Server-only (sharp).
 *
 *   const size = await measureImage(original);              // upright size (EXIF applied)
 *   const plan = planRegion(size, box, model.aspects);
 *   const crop = await cropForEdit(original, plan);         // send as image 1 at plan.aspect
 *   …edit model returns `edited`…
 *   const result = await compositeRegion({ original, edited, plan });
 *
 * Pixels outside `plan.box` in `result` are identical to the decoded original.
 */
export { planRegion, boxToPixels, parseAspect, type PixelRect, type RegionPlan } from './plan';
export { cropForEdit, compositeRegion, matchTone, featherWeight, defaultFeather, type Tone } from './composite';
export { measureImage, decodeRgba } from './pixels';
