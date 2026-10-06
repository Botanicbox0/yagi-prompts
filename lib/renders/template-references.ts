/** Fixed, non-person references supplied by TWINGS after the customer's identity image.
 * Keyed by immutable template ID so title/address edits cannot change the input contract.
 * Only checked-in product assets belong here; never store a sample person's portrait.
 */
export const BEAUTY_AD_TEMPLATE_ID = '4db3c5d0-2f36-4e05-b43f-4c7c25f86b6c';
export const CITY_FASHION_MONTAGE_TEMPLATE_ID = '3e5a686a-d412-4267-a789-1e97b7d8235d';

const PRODUCT_REFERENCES: Readonly<Record<string, readonly string[]>> = {
  [BEAUTY_AD_TEMPLATE_ID]: ['/templates/beauty-ad/yagi-lip-gloss.jpg'],
  [CITY_FASHION_MONTAGE_TEMPLATE_ID]: ['/templates/city-fashion/yagi-yw-logo.png'],
};

export function fixedVideoReferenceUrls(templateId: string, origin: string): string[] {
  return (PRODUCT_REFERENCES[templateId] ?? []).map((path) => new URL(path, origin).href);
}
