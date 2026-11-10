import { WorkspaceHomeLink, WorkspaceSupport } from '@/components/brand-workspace/context-links';
import { getViewer } from '@/lib/auth/viewer';
import { influencersOpen } from '@/lib/influencers/rules';
import { getVerifiedEmail } from '@/lib/auth/verified-email';
import { getSqlRunner } from '@/lib/db/connect';
import { loadCachedBrandWorkspaceScope } from '@/components/brand-workspace/scope';
import "@/app/globals.css";
import "./workspace.css";
import "./rail.css";
import "./studio-v2.css";
import { cookies } from "next/headers";
import { brandStudioV2Open } from "@/lib/flags";
import { RAIL_COOKIE, railCookieExpanded } from "@/components/brand-workspace/rail-model";
import { WorkspaceLanguage } from '@/components/brand-workspace/language';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { studioCopyAllowed } from "@/lib/brand-studio/visibility";
import { WorkspaceIdentity } from '@/components/brand-workspace/identity';
import { BrandErrorCopyProvider } from '@/components/brand-workspace/error-copy';
import { WorkspaceSpotlight } from '@/components/brand-workspace/spotlight';
import { Suspense, type ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/app/fonts";
import { TwingsStudioLockup } from "@/components/brand/twings-mark";
import { YagiLogo } from "@/components/brand/yagi-mark";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
export const dynamic = "force-dynamic";
/** Mobile browser chrome matches the alabaster canvas around the workspace frame. */
export const viewport: Viewport = { themeColor: "#f8f9fa" };
export async function generateMetadata(): Promise<Metadata> {
  const d = getDictionary(await getRequestLocale());
  return {
    title: {
      default: d.brandWorkspace.title,
      template: `%s · ${d.meta.siteName}`,
    },
    robots: { index: false, follow: false },
  };
}
export default async function BrandLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getRequestLocale();
  const d = getDictionary(locale);
  const b = d.brandWorkspace;
  const viewer=await getViewer();
  const sql=viewer.userId?await getSqlRunner():null;
  // Choices only (ids, names, roles, logo routes): deduplicated per server render with the child page.
  const scope=sql?await loadCachedBrandWorkspaceScope(sql,await getVerifiedEmail(viewer.userId),viewer):null;
  // Studio v2 brings the left rail (docs/BRAND-STUDIO-V3.md §3); the navigation still keeps a sandboxed or
  // generation-closed brand on its own sidebar. The cookie only mirrors the rail width for the first paint.
  // A viewer whose brands are all sandboxed or generation-closed never receives a word of studio copy:
  // not in the markup, and not in the props serialized into the page either (hardline, V3 §9-1).
  const studioCopy=!scope||studioCopyAllowed(scope.choices);
  const studioV2=brandStudioV2Open()&&studioCopy;
  const railExpanded=studioV2&&scope?railCookieExpanded((await cookies()).get(RAIL_COOKIE)?.value):false;
  return (
    <html lang={locale} className={fontVariables} data-brand-workspace>
      <head>
        <link
          rel="stylesheet"
          href="/fonts/helvetica-neue/helvetica-neue.css"
        />
        <link
          rel="stylesheet"
          href="/fonts/pretendard/pretendard-dynamic-subset.css"
        />
      </head>
      <body>
        <a href="#main" className="bw-skip-link" data-skip-link>{b.skipToContent}</a>
        <div className="bw-shell">
          <aside className="bw-sidebar">
            <Suspense fallback={null}>
              {scope ? <WorkspaceHomeLink scope={scope}><TwingsStudioLockup size={22} /></WorkspaceHomeLink> : <a href="/brand" className="bw-lockup" aria-label="TWINGS Studio"><TwingsStudioLockup size={22} /></a>}
            </Suspense>
            {/* URL-derived: dynamic render resolves this on the server, the empty fallback never shows. */}
            <Suspense fallback={null}>
              {scope?<WorkspaceIdentity scope={scope} copy={b.identity} roles={b.roles}/>:<p className="bw-kicker">{b.title}</p>}
              <WorkspaceNavigation home={b.home} members={b.members} settings={b.managed.settings} library={b.managed.library} studio={studioCopy?b.productionStudio.title:""} identity={studioCopy?b.identityLayer.nav:undefined} creators={influencersOpen() ? b.creatorPool.nav : undefined} scope={scope} studioV2={studioV2} shell={studioCopy?d.studioShell:undefined} locale={locale==="en"?"en":"ko"} railExpanded={railExpanded}/>
            </Suspense>
            <div className="bw-sidebar-utilities">
              <WorkspaceLanguage locale={locale} label={d.nav.localeToggle} compact applyLabel={b.languageApply}/>
              <form action="/auth/signout" method="post" className="bw-signout">
                <button type="submit" aria-label={b.signOut} title={b.signOut}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10"/></svg>
                  <span>{b.signOut}</span>
                </button>
              </form>
              <div className="ys-powered-by" aria-label="Powered by YAGI">
                <span>Powered by</span>
                <YagiLogo size={16} />
              </div>
            </div>
          </aside>
          <div className="bw-body">
            <main id="main" className="bw-main">
              <BrandErrorCopyProvider copy={{ title: b.unavailable, retry: b.retry }}>{children}</BrandErrorCopyProvider>
            </main>
          </div>
        </div>
        {scope&&<Suspense fallback={null}><WorkspaceSupport scope={scope} b={b} locale={locale}/></Suspense>}
        <WorkspaceSpotlight />
      </body>
    </html>
  );
}
