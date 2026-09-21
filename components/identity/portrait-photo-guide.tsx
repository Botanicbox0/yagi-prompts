import type { Dictionary } from '@/messages/en';

export function PortraitPhotoGuide({ copy }: { copy: Dictionary['portrait'] }) {
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
    <div data-portrait-photo-guide className="mt-5 grid gap-6 sm:grid-cols-2">
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
