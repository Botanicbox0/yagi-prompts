/**
 * Studio-wide clipboard image copy & paste helpers (`Ctrl+C` / `Ctrl+V`, `Cmd+C` / `Cmd+V`).
 *
 * Pure extraction functions have zero DOM requirements beyond standard `File`/`Blob` so unit tests run
 * cleanly in Node, while canvas conversion and `navigator.clipboard` writes activate lazily in browser.
 */
import { STUDIO_UPLOAD_MIMES } from "./contracts";

const UPLOADABLE_IMAGE_MIMES = new Set<string>(STUDIO_UPLOAD_MIMES.image);

const GENERIC_CLIPBOARD_NAMES = new Set([
  "",
  "image",
  "image.png",
  "image.jpg",
  "image.jpeg",
  "image.webp",
  "image.gif",
  "image.bmp",
  "blob",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/** Studio media path `/st/<64 hex>.<png|jpg|webp>` routed via same-origin gateway for untainted `<canvas>`. */
const STUDIO_IMAGE_PATH = /^\/st\/[0-9a-f]{64}\.(png|jpg|webp)$/;

export interface ClipboardDataLike {
  readonly items?: ArrayLike<{
    readonly kind: string;
    readonly type: string;
    getAsFile(): File | null;
  }> | null;
  readonly files?: ArrayLike<File> | null;
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  return MIME_TO_EXT[normalized] ?? "png";
}

function isGenericClipboardName(name: string | undefined | null): boolean {
  if (!name) return true;
  return GENERIC_CLIPBOARD_NAMES.has(name.trim().toLowerCase());
}

function normalizeClipboardFile(file: File, timestamp: number, index: number): File {
  const mime = (file.type || "image/png").toLowerCase().split(";")[0]?.trim() || "image/png";
  if (!isGenericClipboardName(file.name)) return file;
  const ext = extensionForMime(mime);
  const uniqueName = `clipboard-${timestamp}-${index + 1}.${ext}`;
  try {
    return new File([file], uniqueName, {
      type: mime,
      lastModified: file.lastModified || timestamp,
    });
  } catch {
    return file;
  }
}

/**
 * Extracts all `image/*` files from a `ClipboardEvent.clipboardData` (or `DataTransfer`), preferring
 * `items` (`Win+Shift+S` screenshots, browser "Copy image", Figma) and falling back to `files`, with
 * deduplication and unique filenames so consecutive pastes never collide.
 */
export function extractClipboardImages(data: ClipboardDataLike | null | undefined, now: number = Date.now()): File[] {
  if (!data) return [];
  const raw: File[] = [];
  const seenObjects = new Set<File>();
  const seenSignatures = new Set<string>();

  const pushCandidate = (candidate: File | null | undefined, fallbackType?: string) => {
    if (!candidate) return;
    const type = (candidate.type || fallbackType || "").toLowerCase();
    if (!type.startsWith("image/")) return;
    if (seenObjects.has(candidate)) return;
    seenObjects.add(candidate);
    // When browsers populate BOTH `items` and `files` for the same clipboard image, deduplicate by signature.
    const sig = `${candidate.name}:${candidate.size}:${type}:${candidate.lastModified}`;
    if (seenSignatures.has(sig)) return;
    seenSignatures.add(sig);
    raw.push(type !== candidate.type && type ? new File([candidate], candidate.name || "image.png", { type }) : candidate);
  };

  if (data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item || item.kind !== "file") continue;
      if (item.type && !item.type.toLowerCase().startsWith("image/")) continue;
      pushCandidate(item.getAsFile(), item.type);
    }
  }

  if (data.files) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      pushCandidate(file, file?.type);
    }
  }

  return raw.map((file, index) => normalizeClipboardFile(file, now, index));
}

/** Returns true when an event target is a text-editing control (`input`, `textarea`, `select`, `contenteditable`). */
export function isEditableTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("input, textarea, select, [contenteditable='true']"));
}

/** Resolves a studio media URL through the same-origin proxy when needed so `<canvas>` reads stay untainted. */
export function studioDrawableImageUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (typeof window === "undefined") return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return url;
    return STUDIO_IMAGE_PATH.test(parsed.pathname) ? `/api/brand-studio/media${parsed.pathname}` : url;
  } catch {
    return url;
  }
}

function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const resolved = studioDrawableImageUrl(url);
    let src = resolved;
    if (!resolved.startsWith("data:") && !resolved.startsWith("blob:") && typeof window !== "undefined") {
      try {
        if (new URL(resolved, window.location.href).origin !== window.location.origin) {
          img.crossOrigin = "anonymous";
          src = `${resolved}${resolved.includes("?") ? "&" : "?"}canvas=1`;
        }
      } catch {
        /* keep resolved */
      }
    }
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("clipboard image load failed"));
    img.src = src;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Ensures a pasted `image/*` file is one of `STUDIO_UPLOAD_MIMES.image` (`png`, `jpeg`, `webp`),
 * transcoding exotic clipboard formats (`bmp`, `gif`) to `image/png` in the browser when needed.
 */
export async function ensureUploadableImageFile(file: File): Promise<File> {
  if (UPLOADABLE_IMAGE_MIMES.has(file.type)) return file;
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return file;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadBrowserImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
    canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob = await canvasToPngBlob(canvas);
    if (!pngBlob) return file;
    const stem = file.name.replace(/\.[a-z0-9]{2,5}$/i, "") || `clipboard-${Date.now()}`;
    return new File([pngBlob], `${stem}.png`, { type: "image/png", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareClipboardUploadFiles(files: readonly File[]): Promise<File[]> {
  return Promise.all(files.map((file) => ensureUploadableImageFile(file)));
}

async function ensurePngBlob(blob: Blob): Promise<Blob | null> {
  if (blob.type === "image/png") return blob;
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadBrowserImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
    canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToPngBlob(canvas);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Writes an image `Blob` (converted to `image/png` if needed) to `navigator.clipboard`. */
export async function writePngBlobToClipboard(blob: Blob): Promise<{ ok: boolean; byteLength: number }> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return { ok: false, byteLength: 0 };
  }
  try {
    const png = await ensurePngBlob(blob);
    if (!png) return { ok: false, byteLength: 0 };
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return { ok: true, byteLength: png.size };
  } catch {
    return { ok: false, byteLength: 0 };
  }
}

/** Fetches/renders a studio image URL into an untainted PNG `Blob` and writes it to `navigator.clipboard`. */
export async function copyImageUrlToClipboard(url: string): Promise<{ ok: boolean; blob: Blob | null; byteLength: number }> {
  if (typeof document === "undefined") return { ok: false, blob: null, byteLength: 0 };
  try {
    const img = await loadBrowserImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
    canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, blob: null, byteLength: 0 };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await canvasToPngBlob(canvas);
    if (!png) return { ok: false, blob: null, byteLength: 0 };
    const written = await writePngBlobToClipboard(png);
    return { ok: written.ok, blob: png, byteLength: png.size };
  } catch {
    return { ok: false, blob: null, byteLength: 0 };
  }
}

/* ------------------------------------------- in-session layer clipboard */

export interface CopiedStudioLayerEntry<TLayer = unknown> {
  layer: TLayer;
  /** PNG byte length written to `navigator.clipboard` alongside this layer, if any (`0` when not written). */
  writtenByteLength: number;
  copiedAt: number;
}

let copiedStudioLayerEntry: CopiedStudioLayerEntry | null = null;

export function setStudioCopiedLayer<TLayer>(layer: TLayer, writtenByteLength: number = 0): void {
  copiedStudioLayerEntry = {
    layer: JSON.parse(JSON.stringify(layer)) as TLayer,
    writtenByteLength,
    copiedAt: Date.now(),
  };
}

export function getStudioCopiedLayer<TLayer>(): CopiedStudioLayerEntry<TLayer> | null {
  if (!copiedStudioLayerEntry) return null;
  return {
    layer: JSON.parse(JSON.stringify(copiedStudioLayerEntry.layer)) as TLayer,
    writtenByteLength: copiedStudioLayerEntry.writtenByteLength,
    copiedAt: copiedStudioLayerEntry.copiedAt,
  };
}

export function clearStudioCopiedLayer(): void {
  copiedStudioLayerEntry = null;
}
