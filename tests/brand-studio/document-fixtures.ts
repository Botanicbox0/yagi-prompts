/**
 * Real PPTX and PDF bytes for the document tests (docs/BRAND-STUDIO-V6-PLAN.md §4.7), built in memory:
 * a ZIP with the parts a PPTX reader needs, and a one-page PDF with plain text. Invented content only.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFile {
  name: string;
  data: Uint8Array | string;
  /** Stored (0) or deflated (8, default). */
  method?: 0 | 8;
  /** Set the "encrypted" flag on the entry (the bytes are not really encrypted). */
  encrypted?: boolean;
  /** Claim this uncompressed size in the central directory (a zip bomb's lie). */
  claimSize?: number;
}

export function makeZip(files: readonly ZipFile[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : Buffer.from(file.data);
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(raw) >>> 0;
    const flags = file.encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.claimSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paragraphs = (lines: readonly string[]) => lines.map((line) => `<a:p><a:r><a:t>${esc(line)}</a:t></a:r></a:p>`).join('');

export interface DeckSlide {
  lines: string[];
  notes?: string[];
  /** A picture on the slide: its file name in ppt/media and its bytes. */
  picture?: { name: string; bytes: Uint8Array };
}

/**
 * A PPTX whose presentation order is `order` (slide file numbers, 1-based); by default the file order.
 * Slide files are numbered 1..n; `order` lets a test put slide 2 first in the deck.
 */
export function makePptx(slides: readonly DeckSlide[], options: { order?: number[]; extra?: ZipFile[]; encrypted?: boolean } = {}): Uint8Array {
  const order = options.order ?? slides.map((_, i) => i + 1);
  const files: ZipFile[] = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    {
      name: 'ppt/presentation.xml',
      data: `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${order
        .map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n + 10}"/>`)
        .join('')}</p:sldIdLst></p:presentation>`,
      encrypted: options.encrypted,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0"?><Relationships>${slides
        .map((_, i) => `<Relationship Id="rId${i + 11}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
  ];
  slides.forEach((slide, i) => {
    const n = i + 1;
    files.push({ name: `ppt/slides/slide${n}.xml`, data: `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:txBody>${paragraphs(slide.lines)}</p:txBody></p:sld>` });
    const rels: string[] = [];
    if (slide.notes) {
      rels.push(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
      files.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: `<?xml version="1.0"?><p:notes xmlns:a="a" xmlns:p="p">${paragraphs(slide.notes)}</p:notes>` });
    }
    if (slide.picture) {
      rels.push(`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${slide.picture.name}"/>`);
      files.push({ name: `ppt/media/${slide.picture.name}`, data: slide.picture.bytes, method: 0 });
    }
    files.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: `<?xml version="1.0"?><Relationships>${rels.join('')}</Relationships>` });
  });
  return makeZip([...files, ...(options.extra ?? [])]);
}

/** A one-page PDF with the lines as Helvetica text (ASCII only). `encrypted` adds an /Encrypt entry. */
export function makePdf(lines: readonly string[], options: { encrypted?: boolean } = {}): Uint8Array {
  const text = lines.map((line, i) => `BT /F1 12 Tf 50 ${760 - i * 18} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.encrypted ? ' /Encrypt 9 0 R' : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
