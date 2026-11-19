"use client";
/**
 * The role picker: "no role" + the six roles as one row of the upload tab's filter chips (`bsr-chip`), a radio
 * group — one Tab stop (the chosen chip), arrows / Home / End move and choose, as native radios do. Used by the
 * edit dialog (rail/asset-dialog.tsx) and the tray popover (tray.tsx); never a browser `<select>` (TASTE.md
 * 2026-11-16, 2026-11-19).
 */
import { useRef, type KeyboardEvent, type Ref } from "react";
import { STUDIO_ASSET_ROLES, type StudioAssetRole } from "@/lib/brand-studio/contracts";
import "./rail/rail.css";

/** "No role" first, then the six roles: the order the chips show and the arrow keys walk. */
export const ROLE_CHOICES: readonly (StudioAssetRole | "")[] = ["", ...STUDIO_ASSET_ROLES];

/** The choice an arrow, Home or End key moves to from `at` (wrapping), or null for any other key. */
export function roleChoiceAfterKey(key: string, at: number, count = ROLE_CHOICES.length): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export interface RoleChipsProps {
  value: StudioAssetRole | "";
  onChange(value: StudioAssetRole | ""): void;
  noneLabel: string;
  roleLabels: Record<StudioAssetRole, string>;
  /** The id of the visible label above the chips. */
  labelledBy: string;
  describedBy?: string;
  /** Receives the chosen chip, for a container that focuses it on open. */
  chosenRef?: Ref<HTMLButtonElement>;
}

export function RoleChips({ value, onChange, noneLabel, roleLabels, labelledBy, describedBy, chosenRef }: RoleChipsProps) {
  const chips = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    const next = roleChoiceAfterKey(event.key, at);
    if (next === null) return;
    event.preventDefault();
    onChange(ROLE_CHOICES[next]!);
    chips.current[next]?.focus();
  }

  return (
    <div className="bsr-filter bsr-role-pick" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} data-library-role-pick>
      {ROLE_CHOICES.map((choice, at) => {
        const chosen = value === choice;
        return (
          <button
            key={choice || "none"}
            ref={(node) => {
              chips.current[at] = node;
              if (chosen && chosenRef) {
                if (typeof chosenRef === "function") chosenRef(node);
                else (chosenRef as { current: HTMLButtonElement | null }).current = node;
              }
            }}
            type="button"
            role="radio"
            className="bsr-chip"
            aria-checked={chosen}
            data-selected={chosen ? "" : undefined}
            data-role-choice={choice || "none"}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(choice)}
            onKeyDown={(event) => onKey(event, at)}
          >
            {choice ? roleLabels[choice] : noneLabel}
          </button>
        );
      })}
    </div>
  );
}
