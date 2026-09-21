import "@/app/globals.css";
import "./workspace.css";
import { WorkspaceLanguage } from '@/components/brand-workspace/language';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
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
        <div className="bw-shell">
          <aside className="bw-sidebar">
            <a href="/brand" className="bw-lockup">
              <TwingsLogo size={22} />
              <span>{d.admin.byline}</span>
            </a>
            <p className="bw-kicker">{b.title}</p>
            <WorkspaceNavigation home={b.home} members={b.members}/>
            <form action="/auth/signout" method="post" className="bw-signout">
              <button type="submit">{b.signOut}</button>
            </form>
          </aside>
          <div className="bw-body">
            <header className="bw-topbar">
              <span>{b.title}</span>
              <WorkspaceLanguage locale={locale} label={d.nav.localeToggle}/>
              <a href="/brand/projects/new" className="bw-button bw-primary">
                {b.newProject}
              </a>
            </header>
            <main id="main" className="bw-main">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
