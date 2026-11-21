import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec G, B1 (the export's own code): the shared reads (picture index, frame facts) are waited for against the
 * export's cancel and a limit, never aborted, and every one of them happens before the encoder exists, so a
 * slow read cannot leave an encoder idle in a hidden page (A4). The run reads get the export's signal.
 */
const film = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/export-film.ts'), 'utf8');
const facts = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/footage-facts.ts'), 'utf8');
const run = film.slice(film.indexOf('export async function exportFilm('));

describe('the export waits on shared reads with an end, before its encoder exists', () => {
  it('the picture index read at the start is raced against cancel and a limit', () => {
    expect(run).toMatch(/waitShared\(readIndex\(url\)/);
    expect(run).not.toMatch(/await Promise\.all\(cutUrls\.map\(\(url\) => readPictureIndex\(url\)/);
    // One read per file for the whole export, shared with the path choice (spec G, B9).
    expect(run).toMatch(/const readIndex = exportIndexReads\(\);/);
    expect(run).toMatch(/sourceChoice\(url, override, .*signal, readIndex\)/);
  });

  it('every source’s path is settled before the encoder is made', () => {
    const settled = run.indexOf('sourceChoice(url, override');
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(run.indexOf('new VideoEncoder('));
    expect(film).not.toMatch(/await openDecoderSource\(/);
  });

  it('in the export the frame facts and the index are raced (waitShared), on the seek path too', () => {
    const choice = film.slice(film.indexOf('async function sourceChoice('), film.indexOf('function openDecoderSource('));
    expect(choice).toMatch(/waitShared\(work, signal, SHARED_WAIT_MS/);
    expect(choice).toMatch(/shared\(readFootage\(srcUrl\)/);
    expect(choice).toMatch(/shared\(readIndex\(srcUrl\)/);
    const open = film.slice(film.indexOf('async function openSource('), film.indexOf('async function present('));
    expect(open).toMatch(/waitShared\(readFootage\(url\)/);
  });

  it('the clip’s own request takes an abort signal', () => {
    expect(facts).toMatch(/\(start: number, end: number, signal\?: AbortSignal\) => fetch\(corsMediaUrl\(srcUrl\), \{.*credentials: 'same-origin', signal \}\)/);
  });
});

describe('spec G, B3: the export asks whether the codec was measured before anything else about the footage', () => {
  it('codecMeasured comes right after the index, before the colour and the rate', () => {
    const choice = film.slice(film.indexOf('async function sourceChoice('), film.indexOf('function decoderSession('));
    const codec = choice.indexOf('codecMeasured(answer.index.config.entry)');
    expect(codec).toBeGreaterThan(choice.indexOf('if (!answer.ok)'));
    expect(codec).toBeLessThan(choice.indexOf('colourAdmitted('));
  });
});
