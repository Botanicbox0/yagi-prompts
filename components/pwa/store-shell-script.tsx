import { storeShellScript } from '@/lib/mobile/store-shell';

/**
 * The blocking `<head>` script of lib/mobile/store-shell.ts, for the two consumer root layouts. It
 * sets `<html data-store-shell>` before first paint, so `<html>` carries suppressHydrationWarning
 * there (one level: the element's own attributes only).
 */
export function StoreShellScript() {
  return <script dangerouslySetInnerHTML={{ __html: storeShellScript() }} />;
}
