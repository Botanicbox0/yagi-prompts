/**
 * `/admin` — M0 placeholder behind the `is_admin` gate. The v1 editor (metadata, steps, typed
 * block forms, effective-visibility table, preview-as, publish via RPC) lands in M4.
 * There is deliberately NO notification control anywhere before M5 (§3.5).
 */
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-white px-gutter py-16 text-black">
      <p className="font-label text-eyebrow uppercase text-blue">admin</p>
      <h1 className="mt-2 font-display text-title uppercase">CMS</h1>
      <p className="mt-6 text-body">M0 placeholder — the v1 editor lands in M4.</p>
    </main>
  );
}
