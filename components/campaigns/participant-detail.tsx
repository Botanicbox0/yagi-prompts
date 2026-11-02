import { collaborationCopy } from "@/messages/campaign-collaboration";
import type { Participation } from "@/lib/campaigns/collaboration/service";
import { ParticipantForms } from "./collaboration-forms";
export function ParticipantDetail({
  participation: p,
  locale,
  adminForms,
}: {
  participation: Participation;
  locale: string;
  adminForms?: React.ReactNode;
}) {
  const t = collaborationCopy(locale),
    title = locale === "en" ? p.title.en : p.title.ko,
    state = t.states[p.status as keyof typeof t.states] ?? t.states.expired;
  return (
    <article
      className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8"
      data-participant-detail
    >
      <header className="border-b border-hairline pb-7">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {p.creatorProfileUrl && (
          <a
            href={p.creatorProfileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block break-all text-sm text-accent underline"
          >
            {t.participantProfile} · {p.creatorProfileUrl}
          </a>
        )}
        <p className="mt-3 text-sm font-medium text-accent">{state}</p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed opacity-70">
          {t.privacy}
        </p>
      </header>
      {p.role === "creator" && (
        <nav className="my-6 flex flex-wrap gap-4 text-sm">
          <a
            className="text-accent underline"
            href={`/campaigns/${p.slug}/make`}
          >
            {t.make}
          </a>
          <a className="text-accent underline" href="/campaigns/mine">
            {t.mine}
          </a>
        </nav>
      )}
      {!p.threadOpen ? (
        <p className="mt-8 rounded-xl border border-hairline p-6">
          {p.status === "applied" ? t.waiting : t.readOnly}
        </p>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section>
            <h2 className="text-lg font-semibold">{t.conversation}</h2>
            <ol className="my-6 space-y-4">
              {p.messages.map((m) => (
                <li
                  key={m.id}
                  className="rounded-xl border border-hairline p-4"
                >
                  <p className="text-xs opacity-60">
                    {t.roles[m.role as keyof typeof t.roles]} ·{" "}
                    <time dateTime={m.createdAt}>
                      {new Intl.DateTimeFormat(
                        locale === "en" ? "en-US" : "ko-KR",
                        {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Seoul",
                        },
                      ).format(new Date(m.createdAt))}
                    </time>
                  </p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.body}
                  </p>
                </li>
              ))}
            </ol>
            {!p.messages.length && (
              <p className="my-6 text-sm opacity-60">{t.empty}</p>
            )}
            {p.canWrite ? (
              p.role === "studio" ? (
                adminForms
              ) : (
                <ParticipantForms locale={locale} applicationId={p.id} />
              )
            ) : (
              <p className="text-sm opacity-60">{t.readOnly}</p>
            )}
          </section>
          <aside>
            <h2 className="text-lg font-semibold">{t.files}</h2>
            <ul className="mt-5 space-y-4">
              {p.files.map((f) => (
                <li key={f.id}>
                  <a
                    href={f.href}
                    className="break-all text-sm text-accent underline"
                  >
                    {f.name}
                  </a>
                  <p className="mt-1 text-xs opacity-60">
                    {Math.ceil(f.sizeBytes / 1024)} KB ·{" "}
                    {t.roles[f.role as keyof typeof t.roles]}
                  </p>
                </li>
              ))}
            </ul>
            {p.postUrl && (
              <p className="mt-8 text-sm">
                <span className="block opacity-70">{t.post}</span>
                <a
                  href={p.postUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="mt-2 block break-all text-accent underline"
                >
                  {p.postUrl}
                </a>
              </p>
            )}
          </aside>
        </div>
      )}
    </article>
  );
}
