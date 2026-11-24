import { describe, expect, it } from 'vitest';
import {
  EDITOR_ASSET_LIMIT,
  assetRecordOf,
  composeStreamUrl,
  footageConfirmedMissing,
  missingAfterRead,
  streamAssetId,
} from '@/lib/brand-studio/editor-v2/sources';

/**
 * Review of audit A4 (2026-11-24): one 404 is not proof that a file is gone. The footage route answers 404 for a
 * deleted asset, but also for a storage read that failed and for a refused access check. A cut is "missing" only
 * when its file answered 404/410 AND the organization's own record, as the page read it, is complete and does not
 * hold that asset. Anything else is a read that failed now, and the editor behaves as before (stored frame data
 * used, playback tried, the "not read yet" line).
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const A = '40000000-0000-4000-8000-000000000001';
const B = '40000000-0000-4000-8000-000000000002';
const SRC_A = composeStreamUrl(ORG, 'asset', A);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('which asset a cut reads', () => {
  it('the stream address of an asset of this organization', () => {
    expect(streamAssetId(SRC_A, ORG)).toBe(A);
    expect(streamAssetId(composeStreamUrl(ORG, 'asset', A.toUpperCase()), ORG)).toBe(A);
  });

  it('anything else is not an asset this record can speak for', () => {
    expect(streamAssetId(composeStreamUrl(ORG, 'output', A), ORG)).toBeNull();
    expect(streamAssetId(composeStreamUrl(OTHER, 'asset', A), ORG)).toBeNull();
    expect(streamAssetId('https://media.example.test/studio/a.mp4', ORG)).toBeNull();
    expect(streamAssetId('/api/brand-studio/compose?organizationId=x&source=asset&id=not-a-uuid', ORG)).toBeNull();
    expect(streamAssetId('', ORG)).toBeNull();
  });
});

describe('the record is complete only below the page’s limit', () => {
  it(`fewer than ${EDITOR_ASSET_LIMIT} assets: complete; exactly the limit: maybe more beyond it`, () => {
    expect(assetRecordOf(ids(EDITOR_ASSET_LIMIT - 1)).complete).toBe(true);
    expect(assetRecordOf(ids(EDITOR_ASSET_LIMIT)).complete).toBe(false);
    expect(assetRecordOf([]).complete).toBe(true);
  });
});

describe('missing needs a 404 and the organization’s complete record without the asset', () => {
  const present = assetRecordOf([A, B]);
  const absent = assetRecordOf([B]);

  it('a 404 on a cut whose asset is still in the record: a read that failed now, not missing', () => {
    expect(footageConfirmedMissing(SRC_A, true, ORG, present)).toBe(false);
  });

  it('a 404 and the asset absent from a complete record: missing', () => {
    expect(footageConfirmedMissing(SRC_A, true, ORG, absent)).toBe(true);
  });

  it('the asset absent but the file read fine (say an asset made after the page loaded): not missing', () => {
    expect(footageConfirmedMissing(SRC_A, false, ORG, absent)).toBe(false);
  });

  it('a record at its page limit never yields missing, even with a 404 and the asset not on that page', () => {
    const full = assetRecordOf(ids(EDITOR_ASSET_LIMIT));
    expect(full.ids).not.toContain(A);
    expect(footageConfirmedMissing(SRC_A, true, ORG, full)).toBe(false);
  });

  it('no record, a studio result, or an address this record cannot speak for: never missing', () => {
    expect(footageConfirmedMissing(SRC_A, true, ORG, null)).toBe(false);
    expect(footageConfirmedMissing(SRC_A, true, ORG, undefined)).toBe(false);
    expect(footageConfirmedMissing(composeStreamUrl(ORG, 'output', A), true, ORG, absent)).toBe(false);
    expect(footageConfirmedMissing('https://media.example.test/a.mp4', true, ORG, absent)).toBe(false);
  });
});

describe('the mark follows the latest read', () => {
  const GONE = '/media/gone.mp4';
  const BACK = '/media/back.mp4';
  const OTHER_SRC = '/media/other.mp4';

  it('set for what is now missing, cleared for what is not, untouched for what was not read', () => {
    const before = { [BACK]: true as const, [OTHER_SRC]: true as const };
    const after = missingAfterRead(before, [GONE, BACK], (src) => src === GONE);
    expect(after).toEqual({ [GONE]: true, [OTHER_SRC]: true });
  });

  it('nothing changed: the same object (no re-render)', () => {
    const before = { [GONE]: true as const };
    expect(missingAfterRead(before, [GONE, BACK], (src) => src === GONE)).toBe(before);
  });
});
