"use client";
/** Stub until slice E lands (docs/BRAND-STUDIO-V3.md §5). Default export so the studio can load it with next/dynamic. */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { LayerEditorProps } from "../seams";

export default function LayerEditor(_props: LayerEditorProps & { copy: Dictionary["studioLayers"] }) {
  return null;
}
