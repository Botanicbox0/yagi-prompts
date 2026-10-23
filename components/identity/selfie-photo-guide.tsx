import type { Dictionary } from '@/messages/en';

export function SelfiePhotoGuide({ copy }: { copy: Dictionary['selfie'] }) {
  const groups = [
    {
      title: copy.goodExamples,
      positive: true,
      examples: [
        ['clear-face.webp', copy.exampleClear],
        ['front-facing.webp', copy.exampleFront],
      ],
    },
    {
      title: copy.avoidExamples,
      positive: false,
      examples: [
        ['covered-face.webp', copy.exampleCovered],
        ['turned-face.webp', copy.exampleTurned],
      ],
    },
  ];
  return (
    <div data-selfie-photo-guide className="mt-5 grid gap-6 sm:grid-cols-2">
      <div className="flex items-center gap-4 rounded-xl bg-on-surface/5 p-4 sm:col-span-2">
        <svg aria-hidden="true" viewBox="0 0 160 90" className="h-20 w-32 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="51" cy="38" rx="21" ry="28"/><path d="M18 87c2-24 64-24 66 0M43 35h3m12 0h3M49 48h7M44 57q8 5 15 0M76 35h38"/><rect x="116" y="20" width="27" height="37" rx="5"/><circle cx="130" cy="35" r="6"/><path d="M88 35l8-5m-8 5l8 5"/></svg>
        <div><p className="text-sm font-medium">{copy.eyeLevel}</p><p className="mt-2 text-xs leading-relaxed opacity-70">{copy.photoCheckHint}</p></div>
      </div>
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full border border-current text-xs">
              {group.positive ? '✓' : '×'}
            </span>
            {group.title}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {group.examples.map(([file, label]) => (
              <figure key={file}>
                <div className="aspect-[4/5] overflow-hidden rounded-lg bg-black/5">
                  <img src={`/images/portrait-guide/${file}`} alt={label} className="h-full w-full object-contain" loading="lazy" />
                </div>
                <figcaption className="mt-2 text-xs leading-relaxed opacity-75">{label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
