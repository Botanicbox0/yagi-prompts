import { DEFAULT_ANDROID_PACKAGE } from './store-bridge';

/**
 * "Is this page inside the Google Play app?" — docs/PLATFORM-2.0.md §5.1 (founder decision
 * 2026-10-28): the Play app is a Trusted Web Activity over twings.app that sells nothing. Google
 * Play's Payments policy allows a consumption-only app as long as nothing, digital or physical, can
 * be bought inside it; text may say purchases happen on the website, without a link.
 *
 * A TWA is Chrome itself, so neither the user agent nor a request header can say so, and cookies and
 * localStorage are shared with the user's ordinary Chrome tabs — a flag there would hide checkout in
 * the browser too. What is the app's own: the launch URL (`startUrl` in mobile/twa-manifest.json
 * carries `?source=twa`), the `android-app://<package>/` referrer Chrome gives the launch, and the
 * tab's sessionStorage. No directive on purpose: the layouts render the script string on the server.
 */

/** The launch marker: `startUrl` and every shortcut in mobile/twa-manifest.json carry it. */
export const TWA_SOURCE = 'twa';

/** sessionStorage key — one tab's memory, never the browser's. */
export const STORE_SHELL_KEY = 'twings:store-shell';

/** `<html data-store-shell="android">`, which app/globals.css and `useStoreShell` read. */
export const STORE_SHELL_ATTRIBUTE = 'data-store-shell';

const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** The Play package id, from `ANDROID_PACKAGE_NAME` when it is a real package name. */
export function androidPackageName(env: Record<string, string | undefined> = process.env): string {
  const value = env.ANDROID_PACKAGE_NAME?.trim();
  return value && PACKAGE_NAME.test(value) ? value : DEFAULT_ANDROID_PACKAGE;
}

/**
 * The blocking `<head>` script. It runs before first paint, so a static template page never flashes
 * its price box inside the app. The package name is checked against PACKAGE_NAME before it is
 * written into the source.
 */
export function storeShellScript(packageName: string = androidPackageName()): string {
  const name = PACKAGE_NAME.test(packageName) ? packageName : DEFAULT_ANDROID_PACKAGE;
  const referrer = `android-app://${name}/`;
  return [
    '(function(){try{',
    `var k=${JSON.stringify(STORE_SHELL_KEY)},s=null;`,
    'try{s=window.sessionStorage}catch(e){}',
    `var launch=new URLSearchParams(location.search).get('source')===${JSON.stringify(TWA_SOURCE)}`,
    `||document.referrer===${JSON.stringify(referrer.slice(0, -1))}`,
    `||document.referrer.indexOf(${JSON.stringify(referrer)})===0;`,
    "var kept=false;try{kept=!!s&&s.getItem(k)==='android'}catch(e){}",
    "if(launch&&s){try{s.setItem(k,'android')}catch(e){}}",
    `if(launch||kept)document.documentElement.setAttribute(${JSON.stringify(STORE_SHELL_ATTRIBUTE)},'android');`,
    '}catch(e){}})();',
  ].join('');
}
