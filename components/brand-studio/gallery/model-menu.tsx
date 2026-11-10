"use client";
/**
 * The model chip of the prompt bar and its list: each model's name, one line on what it is good at,
 * and what one image costs at the bar's current settings, in credits (docs/BRAND-STUDIO-V3.md §4).
 * A listbox: ↑/↓ move, Enter or a press picks, Escape closes and focus goes back to the chip.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { StudioImageModel, StudioModel } from "@/lib/brand-studio/models";
import { credits, type StudioCopy, type StudioLocale } from "../copy";
import { imageCreditsFor, type DockDraft } from "../dock-model";
import { StudioIcon } from "../icons";
import { moveFocus, useDismiss } from "./menu";

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
}

export function modelHint(copy: StudioCopy, model: Pick<StudioModel, "hintKey">): string {
  return copy.models[model.hintKey as keyof StudioCopy["models"]] ?? "";
}

export function ModelMenu({ models, value, draft, references, copy, locale, initialOpen = false, onChange }: ModelMenuProps) {
  const [open, setOpen] = useState(initialOpen);
  const chip = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = models.find((m) => m.id === value) ?? models[0];
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) chip.current?.focus();
    });
  };
  return (
    <span className="bs-model" data-control="model">
      <button
        ref={chip}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${copy.dock.model}: ${current?.label ?? ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="bs-chip-value">{current?.label}</span>
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
  onPick,
  onClose,
}: Omit<ModelMenuProps, "onChange" | "initialOpen"> & { id: string; onPick(id: string): void; onClose(): void }) {
  const box = useDismiss(onClose);
  useEffect(() => {
    (box.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? box.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [box]);
  return (
    <div ref={box} className="bs-menu bs-model-list" data-studio-model-list>
      <p className="bs-menu-title" id={`${id}-title`}>
        {copy.dock.modelMenu}
      </p>
      <div id={id} role="listbox" aria-labelledby={`${id}-title`} onKeyDown={(event) => moveFocus(event, '[role="option"]')}>
        {models.map((model) => {
          const selected = model.id === value;
          const perImage = model.medium === "image" ? imageCreditsFor(model as StudioImageModel, draft, references) : null;
          return (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-model={model.id}
              onClick={() => onPick(model.id)}
            >
              <span className="bs-model-name">
                {model.label}
                {selected && <StudioIcon name="check" />}
              </span>
              <span className="bs-model-hint">{modelHint(copy, model)}</span>
              {perImage !== null && <span className="bs-model-cost bs-num">{credits(copy.dock.perImage, perImage, locale)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
