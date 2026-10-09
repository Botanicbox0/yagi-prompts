import { notFound } from 'next/navigation';

export const revalidate = 3600;

/** Route unmatched public paths through the existing static bilingual 404 boundary. */
export default function MissingPublicPage(): never {
  notFound();
}
