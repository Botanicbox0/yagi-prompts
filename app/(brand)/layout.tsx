import { SupportDrawer } from '@/components/brand-workspace/support';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { loadBrandWorkspace } from '@/lib/brands/workspace/service';
import "@/app/globals.css";
import "./workspace.css";
import { WorkspaceLanguage } from '@/components/brand-workspace/language';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { navigationVisibility, workspaceAccess } from '@/components/brand-workspace/access';
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { fontVariables } from "@/app/fonts";
import { TwingsLogo } from "@/components/brand/twings-mark";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
export const dynamic = "force-dynamic";
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
  const workspace=sql?await loadBrandWorkspace({sql},viewer):null;
  const visible=navigationVisibility(workspace?workspaceAccess(workspace):null);
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
            <a href="/brand" className="bw-lockup">
              <TwingsLogo size={22} />
              <span>{d.admin.byline}</span>
            </a>
            <p className="bw-kicker">{b.title}</p>
            <WorkspaceNavigation home={b.home} members={b.members} settings={b.managed.settings} library={b.managed.library} studio={b.productionStudio.title} visible={visible}/>
            <div className="bw-sidebar-utilities">
              <WorkspaceLanguage locale={locale} label={d.nav.localeToggle} compact applyLabel={b.languageApply}/>
              <form action="/auth/signout" method="post" className="bw-signout">
                <button type="submit" aria-label={b.signOut} title={b.signOut}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10"/></svg>
                  <span>{b.signOut}</span>
                </button>
              </form>
            </div>
          </aside>
          <div className="bw-body">
            <main id="main" className="bw-main">
              {children}
            </main>
          </div>
        </div>
        {workspace&&<SupportDrawer organizations={workspace.organizations} b={b} locale={locale}/>}
      </body>
    </html>
  );
}
