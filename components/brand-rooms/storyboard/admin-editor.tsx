"use client";
/**
 * The team's storyboard editor (`/admin/brand-rooms/storyboards/[id]`): the same editor the brand uses,
 * writing through the registered `brand_rooms.storyboard.*` operations (`/admin/do`). After a write the
 * server page re-renders (`router.refresh()`) and the editor starts again from the saved board.
 */
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { StoryboardBoardView } from "@/lib/brand-rooms/storyboard-contracts";
import { StoryboardEditor } from "./editor";
import type { StoryboardCopy } from "./views";
import { adminWriter } from "./writers";
import "./storyboard.css";

export function AdminStoryboardEditor({ board, copy, back }: { board: StoryboardBoardView; copy: StoryboardCopy; back: string }) {
  const router = useRouter();
  const writer = useMemo(() => adminWriter({ id: board.id }, back), [board.id, back]);
  return (
    <div className="brs" data-admin-storyboard-editor={board.id}>
      <StoryboardEditor
        key={`${board.id}:${board.updatedAt}`}
        board={board}
        copy={copy}
        writer={writer}
        onSaved={() => router.refresh()}
        onShared={() => router.refresh()}
        shareLabel={copy.admin.share}
      />
    </div>
  );
}
