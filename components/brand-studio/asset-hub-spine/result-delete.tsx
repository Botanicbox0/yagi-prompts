"use client";
/**
 * Spine-only result delete trigger and inline confirmation inside `HubDetail` (R-A §2.4).
 * Kept separate from `asset-hub.tsx` and `asset-hub-tile.tsx` so shared files add zero hooks.
 */
import { useState } from "react";
import type { StudioAssetView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isFailure, type StudioApi } from "../api";
import s from "../asset-hub.module.css";
import type { StudioCopy } from "../copy";
import sp from "./asset-hub-spine.module.css";
import { planResultDelete, resultDeleteErrorMessage } from "./model";

export interface SpineResultDeleteProps {
  output: Pick<StudioOutputView, "id" | "savedAssetId">;
  assets?: readonly Pick<StudioAssetView, "id" | "sourceOutputId">[] | null;
  api: StudioApi;
  studioCopy: StudioCopy;
  spineCopy: Dictionary["studioLibrary"]["hub"]["spine"];
  onDeleted(savedCopyId?: string): void;
  /** Deterministic override for SSR markup tests. */
  initialConfirming?: boolean;
}

export function SpineResultDelete({
  output,
  assets,
  api,
  studioCopy,
  spineCopy,
  onDeleted,
  initialConfirming = false,
}: SpineResultDeleteProps) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = planResultDelete(output, assets);

  const confirmDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = plan.withSavedCopy
        ? await api.deleteResultWithSavedCopy(plan.outputId)
        : await api.call("output.delete", { organizationId: api.organizationId, outputId: plan.outputId });
      if (isFailure(res)) {
        setError(resultDeleteErrorMessage(res.code, studioCopy));
        return;
      }
      onDeleted(res.savedCopyId);
    } catch {
      setError(resultDeleteErrorMessage("failed", studioCopy));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={sp.resultDeleteWrap}>
      {!confirming ? (
        <button
          type="button"
          className={sp.resultDeleteBtn}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          data-asset-hub-result-delete=""
        >
          {studioCopy.viewer.delete}
        </button>
      ) : (
        <div
          className={sp.resultDeleteConfirm}
          role="group"
          aria-label={studioCopy.viewer.delete}
          data-asset-hub-result-delete-confirm=""
        >
          <p className={sp.resultDeleteLead}>{studioCopy.viewer.deleteConfirm}</p>
          {plan.showDeleteBothLine && (
            <p className={sp.resultDeleteExtra} data-asset-hub-delete-both="">
              {spineCopy.deleteBoth}
            </p>
          )}
          {error && (
            <p className={sp.resultDeleteError} role="alert" data-asset-hub-result-delete-error="">
              {error}
            </p>
          )}
          <div className={sp.resultDeleteActions}>
            <button
              type="button"
              className={s.quietBtn}
              disabled={busy}
              onClick={() => {
                setError(null);
                setConfirming(false);
              }}
              data-asset-hub-result-delete-cancel=""
            >
              {studioCopy.viewer.cancel}
            </button>
            <button
              type="button"
              className={sp.resultDeleteConfirmBtn}
              disabled={busy}
              onClick={() => void confirmDelete()}
              data-asset-hub-result-delete-yes=""
            >
              {studioCopy.viewer.delete}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
