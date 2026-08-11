import type { BlockKind } from '@/lib/content/schemas';
import { resolveVisibility, type DefaultPolicy } from '@/lib/content/visibility';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { AdminBlock, AdminRevision, AdminStep } from '@/lib/admin/repo';
import { AddBlockForm, AddBlockPicker, BlockFields, VisibilitySelect } from './block-forms';
import { BUTTON, BUTTON_PRIMARY, Field, LocalePair, OpForm, Panel } from './chrome';
import { kindLabel } from './labels';

/**
 * §3.8 — the step list (add / remove / rename, up/down ordering only) and, inside each step, the
 * per-kind block editor with its visibility override.
 *
 * Every control is its own `<form>`: reordering, deleting and saving are separate operations with
 * separate guards, and a browser with no JS drives all of them. The reorder buttons are rendered
 * unconditionally — the operation answers "nothing to do" at the ends rather than the UI guessing.
 */

function MoveButtons({
  dict,
  op,
  field,
  id,
  back,
}: {
  dict: Dictionary['admin'];
  op: 'step.move' | 'block.move';
  field: 'stepId' | 'blockId';
  id: string;
  back: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {(['up', 'down'] as const).map((direction) => (
        <OpForm key={direction} op={op} back={back}>
          <input type="hidden" name={field} value={id} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            className={BUTTON}
            aria-label={direction === 'up' ? dict.moveUp : dict.moveDown}
          >
            {direction === 'up' ? '↑' : '↓'}
          </button>
        </OpForm>
      ))}
    </div>
  );
}

function BlockEditor({
  dict,
  block,
  policy,
  back,
}: {
  dict: Dictionary;
  block: AdminBlock;
  policy: DefaultPolicy;
  back: string;
}) {
  const a = dict.admin;
  const inherited = resolveVisibility(null, block.kind, policy);

  return (
    <article
      data-admin-block={block.id}
      data-block-kind={block.kind}
      className="border border-hairline"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <span className="font-label text-eyebrow uppercase opacity-60">
          {block.order}. {kindLabel(dict, block.kind)}
        </span>
        <div className="flex items-center gap-2">
          <MoveButtons dict={a} op="block.move" field="blockId" id={block.id} back={back} />
          <OpForm op="block.delete" back={back}>
            <input type="hidden" name="blockId" value={block.id} />
            <button type="submit" className={BUTTON}>
              {a.deleteBlock}
            </button>
          </OpForm>
        </div>
      </header>
      <OpForm op="block.update" back={back} className="grid gap-4 p-3">
        <input type="hidden" name="blockId" value={block.id} />
        <BlockFields dict={dict} kind={block.kind} content={block.content} />
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,16rem)_auto]">
          <Field label={a.colOverride}>
            <VisibilitySelect dict={a} value={block.visibility} effectiveDefault={inherited} />
          </Field>
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveBlock}
            </button>
          </div>
        </div>
      </OpForm>
    </article>
  );
}

function StepCard({
  dict,
  step,
  policy,
  back,
  addForStep,
  addKind,
}: {
  dict: Dictionary;
  step: AdminStep;
  policy: DefaultPolicy;
  back: string;
  addForStep: string | null;
  addKind: BlockKind | null;
}) {
  const a = dict.admin;
  return (
    <section data-admin-step={step.id} className="border border-hairline">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <span className="font-label text-eyebrow uppercase">
          {a.stepsHeading} {step.order}
        </span>
        <div className="flex items-center gap-2">
          <MoveButtons dict={a} op="step.move" field="stepId" id={step.id} back={back} />
          <OpForm op="step.delete" back={back}>
            <input type="hidden" name="stepId" value={step.id} />
            <button type="submit" className={BUTTON}>
              {a.deleteStep}
            </button>
          </OpForm>
        </div>
      </header>

      <div className="p-4">
        <OpForm op="step.update" back={back} className="grid gap-4">
          <input type="hidden" name="stepId" value={step.id} />
          <LocalePair label={a.stepTitle} name="title" value={step.title} />
          <LocalePair
            label={a.stepBody}
            name="body"
            value={step.body}
            hint={a.stepBodyHint}
            multiline
          />
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.saveStep}
            </button>
          </div>
        </OpForm>

        <div className="mt-6 grid gap-4">
          {step.blocks.length === 0 ? (
            <p className="font-mono text-code opacity-50">{a.blocksEmpty}</p>
          ) : (
            step.blocks.map((block) => (
              <BlockEditor key={block.id} dict={dict} block={block} policy={policy} back={back} />
            ))
          )}
        </div>

        <div className="mt-5 border-t border-hairline pt-4">
          <AddBlockPicker dict={dict} stepId={step.id} back={back} />
          {addForStep === step.id && addKind !== null && (
            <AddBlockForm dict={dict} stepId={step.id} kind={addKind} back={back} />
          )}
        </div>
      </div>
    </section>
  );
}

export function StepEditor({
  dict,
  revision,
  policy,
  back,
  addForStep,
  addKind,
}: {
  dict: Dictionary;
  revision: AdminRevision;
  policy: DefaultPolicy;
  back: string;
  addForStep: string | null;
  addKind: BlockKind | null;
}) {
  const a = dict.admin;
  return (
    <Panel title={a.stepsHeading}>
      <div className="grid gap-6">
        {revision.steps.length === 0 ? (
          <p className="font-mono text-code opacity-60">{a.stepsEmpty}</p>
        ) : (
          revision.steps.map((step) => (
            <StepCard
              key={step.id}
              dict={dict}
              step={step}
              policy={policy}
              back={back}
              addForStep={addForStep}
              addKind={addKind}
            />
          ))
        )}
      </div>

      <OpForm op="step.create" back={back} className="mt-6 grid gap-4 border-t border-hairline pt-5">
        <input type="hidden" name="revisionId" value={revision.id} />
        <LocalePair label={a.stepTitle} name="title" value={null} />
        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.addStep}
          </button>
        </div>
      </OpForm>
    </Panel>
  );
}
