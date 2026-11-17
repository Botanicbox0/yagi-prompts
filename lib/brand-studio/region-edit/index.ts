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
 *
 * Region edit v2 (`BRAND_STUDIO_REGION_V2`): `planRegionWindow(size, box)` instead of `planRegion`; the
 * same crop and composite calls then send a wide window and paste back only what changed near the box
 * (`plan.box` is the paste zone, `plan.select` the customer's box).
 */
export { planRegion, boxToPixels, parseAspect, type PixelRect, type RegionPlan } from './plan';
export {
  cropForEdit,
  compositeRegion,
  matchTone,
  featherWeight,
  defaultFeather,
  type Tone,
  type CompositeRegionResult,
} from './composite';
export {
  alignEditedRoi,
  computeDiffMask,
  diffMaskAt,
  MAX_RING_RESIDUAL,
  type AlignTransform,
  type AlignedRoiResult,
} from './align';
export { measureImage, decodeRgba } from './pixels';
export { planRegionWindow, pasteZone, describeSelection, selectionLine, SEEDREAM_2K_SIZES, SEEDREAM_EDIT_ASPECTS, type SelectionPlace } from './window';
export { computeChangeMask, type ChangeMask } from './paste';
