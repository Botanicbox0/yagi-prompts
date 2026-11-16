/**
 * A small ZIP reader for PPTX documents (docs/BRAND-STUDIO-V6-PLAN.md §4.7). No dependency: the central
 * directory is read from the end of the file, entries are inflated with Node's zlib with an output cap.
 *
 * Built for files a customer uploads, so it refuses rather than trusts: too many entries, an entry or a
 * total that would inflate past the caps (zip bombs), encrypted entries, methods other than stored and
 * deflate, and offsets that point outside the file all end in `ZipRefused`. Server-only.
 */
import { inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = {
  entriesMax: 4000,
  /** One entry, inflated. */
  entryBytesMax: 40_000_000,
  /** Every entry read, inflated, together. */
  totalBytesMax: 150_000_000,
} as const;

export class ZipRefused extends Error {
  constructor(readonly reason: 'not_zip' | 'too_many_entries' | 'too_large' | 'encrypted' | 'unsupported') {
    super(`zip refused: ${reason}`);
    this.name = 'ZipRefused';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The entries of a ZIP, from its central directory. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let at = bytes.byteLength - 22; at >= min; at--) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipRefused('not_zip');
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new ZipRefused('unsupported'); // ZIP64
  if (count > ZIP_LIMITS.entriesMax) throw new ZipRefused('too_many_entries');
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipEntry[] = [];
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL) throw new ZipRefused('not_zip');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > bytes.byteLength) throw new ZipRefused('not_zip');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (flags & 0x1) throw new ZipRefused('encrypted');
    if (size > ZIP_LIMITS.entryBytesMax) throw new ZipRefused('too_large');
    entries.push({ name, method, compressedSize, size, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reads entries by name, keeping a running total against `ZIP_LIMITS.totalBytesMax`. */
export function zipReader(bytes: Uint8Array, entries: readonly ZipEntry[] = zipEntries(bytes)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let total = 0;
  return {
    has: (name: string) => byName.has(name),
    names: () => [...byName.keys()],
    /** The inflated bytes of `name`, or null when there is no such entry. */
    read(name: string): Uint8Array | null {
      const entry = byName.get(name);
      if (!entry) return null;
      const at = entry.localOffset;
      if (at + 30 > bytes.byteLength || view.getUint32(at, true) !== LOCAL) throw new ZipRefused('not_zip');
      const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
      const end = start + entry.compressedSize;
      if (end > bytes.byteLength) throw new ZipRefused('not_zip');
      const raw = bytes.subarray(start, end);
      let out: Uint8Array;
      if (entry.method === 0) out = raw;
      else if (entry.method === 8) {
        try {
          out = new Uint8Array(inflateRawSync(raw, { maxOutputLength: ZIP_LIMITS.entryBytesMax }));
        } catch {
          throw new ZipRefused('too_large');
        }
      } else throw new ZipRefused('unsupported');
      total += out.byteLength;
      if (total > ZIP_LIMITS.totalBytesMax) throw new ZipRefused('too_large');
      return out;
    },
    text(name: string): string | null {
      const out = this.read(name);
      return out ? new TextDecoder('utf-8', { fatal: false }).decode(out) : null;
    },
  };
}
