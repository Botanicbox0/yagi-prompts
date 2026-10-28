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
