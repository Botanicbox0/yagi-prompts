"use client";
/**
 * The model chip of the prompt bar and its list: each model's name, one line on what it is good at,
 * and what one image costs at the bar's current settings, in credits (docs/BRAND-STUDIO-V3.md §4).
 * A listbox: ↑/↓ move, Enter or a press picks, Escape closes and focus goes back to the chip.
 *
 * On the image screen (`picked` given) every row also has a check, so one request can go to two or three
 * models at once (../group-model.ts). A press on the row still picks that model alone and closes the list,
 * exactly as before; the check (or Space) adds the model to the pick or takes it out and keeps the list
 * open. A full pick (three) or a tray with more references than a model takes disables that check with a
 * short reason; the last checked model cannot be unchecked. The chip shows the first model and "+N".
 */
import { useEffect, useId, useRef, useState } from "react";
import type { StudioImageModel, StudioModel } from "@/lib/brand-studio/models";
import { credits, fill, type StudioCopy, type StudioLocale } from "../copy";
import { imageCreditsFor, type DockDraft } from "../dock-model";
import type { CheckBlock } from "../group-model";
import { StudioIcon } from "../icons";
import { focusOption, moveFocus, useDismiss } from "./menu";

export interface ModelMenuProps {
  models: readonly StudioModel[];
  value: string;
  draft: Pick<DockDraft, "resolution">;
  references: number;
  copy: StudioCopy;
  locale: StudioLocale;
  /** Opens the list first (tests). */
  initialOpen?: boolean;
  onChange(id: string): void;
  /** The image screen: the models picked now (1 to 3, in order). Absent: one model, no checks. */
  picked?: readonly string[];
  /** Why a model's check cannot be ticked now, or null. */
  blockOf?(id: string): CheckBlock | null;
  /** The check of one model was pressed. */
  onToggle?(id: string): void;
}

export function modelHint(copy: StudioCopy, model: Pick<StudioModel, "hintKey">): string {
  return copy.models[model.hintKey as keyof StudioCopy["models"]] ?? "";
}

/** The reason under a model whose check is closed. */
export function blockLine(block: CheckBlock, copy: StudioCopy): string {
  return block.kind === "full" ? fill(copy.dock.modelLimit, { n: block.max }) : fill(copy.dock.modelRefLimit, { have: block.have, max: block.max });
}

export function ModelMenu({ models, value, draft, references, copy, locale, initialOpen = false, onChange, picked, blockOf, onToggle }: ModelMenuProps) {
  const [open, setOpen] = useState(initialOpen);
  const chip = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = models.find((m) => m.id === value) ?? models[0];
  const chosen = picked && picked.length > 1 ? picked.map((m) => models.find((x) => x.id === m)?.label ?? m) : null;
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) chip.current?.focus({ preventScroll: true });
    });
  };
  return (
    <span className="bs-model" data-control="model" data-picked={chosen ? chosen.length : undefined}>
      <button
        ref={chip}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${copy.dock.model}: ${chosen ? chosen.join(", ") : (current?.label ?? "")}`}
        onClick={() => setOpen(!open)}
      >
        <span className="bs-chip-value">{current?.label}</span>
        {chosen && (
          <span className="bs-chip-more bs-num" data-studio-model-more aria-hidden="true">
            +{chosen.length - 1}
          </span>
        )}
        <StudioIcon name="chevron" />
      </button>
      {open && (
        <ModelList
          id={`${id}-list`}
          models={models}
          value={value}
          draft={draft}
          references={references}
          copy={copy}
          locale={locale}
          picked={picked}
          blockOf={blockOf}
          onToggle={onToggle}
          onPick={(next) => {
            onChange(next);
            close();
          }}
          onClose={close}
        />
      )}
    </span>
  );
}

function ModelList({
  id,
  models,
  value,
  draft,
  references,
  copy,
  locale,
  picked,
  blockOf,
  onToggle,
  onPick,
  onClose,
}: Omit<ModelMenuProps, "onChange" | "initialOpen"> & { id: string; onPick(id: string): void; onClose(): void }) {
  const box = useDismiss(onClose);
  const multi = Boolean(picked && onToggle);
  useEffect(() => {
    focusOption(box.current, box.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? box.current?.querySelector<HTMLElement>('[role="option"]'));
  }, [box]);
  const full = multi && models.some((model) => blockOf?.(model.id)?.kind === "full");
  const toggle = (model: string) => {
    if (!picked || !onToggle) return;
    const on = picked.includes(model);
    if (on ? picked.length <= 1 : blockOf?.(model)) return;
    onToggle(model);
  };
  return (
    <div ref={box} className="bs-menu bs-model-list" data-studio-model-list data-multi={multi ? "" : undefined}>
      <p className="bs-menu-title" id={`${id}-title`}>
        {copy.dock.modelMenu}
      </p>
      {multi && (
        <p className="bs-model-intro" id={`${id}-intro`}>
          {copy.dock.modelMenuHint}
        </p>
      )}
      <div
        id={id}
        role="listbox"
        aria-labelledby={`${id}-title`}
        aria-describedby={multi ? `${id}-intro` : undefined}
        aria-multiselectable={multi || undefined}
        onKeyDown={(event) => moveFocus(event, '[role="option"]')}
      >
        {models.map((model) => {
          const selected = multi ? picked!.includes(model.id) : model.id === value;
          const perImage = model.medium === "image" ? imageCreditsFor(model as StudioImageModel, draft, references) : null;
          const block = multi && !selected ? (blockOf?.(model.id) ?? null) : null;
          const last = multi && selected && picked!.length <= 1;
          const reason = block && block.kind === "references" ? blockLine(block, copy) : null;
          return (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-model={model.id}
              data-check-closed={block || last ? "" : undefined}
              aria-describedby={reason ? `${id}-${model.id.replace(/[^A-Za-z0-9_-]/g, "_")}-why` : undefined}
              onClick={() => onPick(model.id)}
              onKeyDown={(event) => {
                // Space adds this model to the pick or takes it out; Enter (a press) picks it alone.
                if (multi && event.key === " ") {
                  event.preventDefault();
                  toggle(model.id);
                }
              }}
            >
              {multi && (
                <span
                  className="bs-model-check"
                  data-model-check={model.id}
                  data-checked={selected ? "" : undefined}
                  data-closed={block || last ? "" : undefined}
                  title={block ? blockLine(block, copy) : undefined}
                  aria-hidden="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(model.id);
                  }}
                >
                  <span className="bs-model-box">{selected && <StudioIcon name="check" />}</span>
                </span>
              )}
              <span className="bs-model-name">
                {model.label}
                {!multi && selected && <StudioIcon name="check" />}
              </span>
              <span className="bs-model-hint" id={reason ? `${id}-${model.id.replace(/[^A-Za-z0-9_-]/g, "_")}-why` : undefined} data-blocked={reason ? "" : undefined}>
                {reason ?? modelHint(copy, model)}
              </span>
              {perImage !== null && <span className="bs-model-cost bs-num">{credits(copy.dock.perImage, perImage, locale)}</span>}
            </button>
          );
        })}
      </div>
      {full && (
        <p className="bs-model-limit" role="status" data-studio-model-limit>
          {fill(copy.dock.modelLimit, { n: picked!.length })}
        </p>
      )}
    </div>
  );
}
