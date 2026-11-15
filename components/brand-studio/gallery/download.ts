/**
 * Saving several results at once from the wall's selection bar. Each file is read and handed to the
 * browser as a download with its own name, one after another, so nothing opens in a new tab. A file on
 * the media domain is read under its own cache entry (lib/brand-studio/cors-media-url.ts: the copy the
 * wall already cached carries no permission to be read). A file that still cannot be read falls back to
 * the plain download link the viewer uses.
 */
import type { StudioOutputView } from "@/lib/brand-studio/contracts";
import { corsMediaUrl } from "@/lib/brand-studio/cors-media-url";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** `twings-<first 8 of the result id>.<type>`: the type from the file itself, else its address, else the kind. */
export function downloadName(output: Pick<StudioOutputView, "id" | "url" | "kind">, mime: string): string {
  const fromMime = EXTENSIONS[mime.split(";")[0]!.trim().toLowerCase()];
  const fromUrl = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(output.url)?.[1]?.toLowerCase();
  const extension = fromMime ?? fromUrl ?? (output.kind === "video" ? "mp4" : "png");
  return `twings-${output.id.slice(0, 8)}.${extension}`;
}

function click(href: string, name: string | null) {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noopener noreferrer";
  if (name) link.download = name;
  else {
    link.download = "";
    link.target = "_blank";
  }
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Downloads each result in turn; resolves with how many could only be opened through the fallback link. */
export async function downloadOutputs(outputs: readonly Pick<StudioOutputView, "id" | "url" | "kind">[]): Promise<{ fallback: number }> {
  let fallback = 0;
  for (const output of outputs) {
    try {
      const response = await fetch(corsMediaUrl(output.url));
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      click(href, downloadName(output, blob.type));
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch {
      fallback += 1;
      click(output.url, null);
    }
    // Browsers drop downloads started in the same instant.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { fallback };
}
