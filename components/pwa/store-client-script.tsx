import { STORE_CLIENT_SCRIPT } from '@/lib/mobile/store-bridge';

/**
 * The store-binary marker (lib/mobile/store-bridge.ts), inline in `<head>` so it runs before first
 * paint. It only ever ADDS `data-store`/`data-standalone` to `<html>`, which is why both root layouts
 * put `suppressHydrationWarning` on that element and nowhere else.
 */
export function StoreClientScript() {
  return <script id="twings-store-client" data-store-client-script dangerouslySetInnerHTML={{ __html: STORE_CLIENT_SCRIPT }} />;
}
