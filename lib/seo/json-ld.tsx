import type { StructuredData } from './structured-data';

/** JSON embedded in HTML must not be able to close the script element. */
export function serializeJsonLd(data: StructuredData): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (character) => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

export function JsonLd({ data, id }: { data: StructuredData | null; id: string }) {
  if (!data) return null;
  return <script id={id} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
