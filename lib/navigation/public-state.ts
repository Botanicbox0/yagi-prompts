/** URL state stays in the client so the public catalog can keep its shared static HTML. */
export function readUseCase(search: string, options: readonly string[]): string | null {
  const value = new URLSearchParams(search).get('useCase');
  return value && options.includes(value) ? value : null;
}

export function useCaseHref(href: string, value: string | null, options: readonly string[]): string {
  const url = new URL(href);
  if (value && options.includes(value)) url.searchParams.set('useCase', value);
  else url.searchParams.delete('useCase');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Section links match their fragment; page links also match genuine descendant routes. */
export function isPublicNavCurrent(href: string, pathname: string | null, hash: string): boolean {
  if (!pathname || !href.startsWith('/') || href.startsWith('//')) return false;
  const destination = new URL(href, 'https://twings.app');
  const clean = (path: string) => path.replace(/\/+$/, '') || '/';
  const target = clean(destination.pathname);
  const current = clean(pathname);
  if (destination.hash) return target === current && destination.hash === hash;
  return target === current || (target !== '/' && current.startsWith(`${target}/`));
}
