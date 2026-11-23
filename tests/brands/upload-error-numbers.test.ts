import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import { BRAND_ATTACHMENT_LIMITS } from '@/lib/brands/workspace/schemas';
import { ROOM_LIMITS } from '@/lib/brand-rooms/message-contracts';
import { STORYBOARD_LIMITS } from '@/lib/brand-rooms/storyboard-contracts';
import {
  BRAND_ATTACHMENT_DISPLAY_LIMITS,
  formatLimitMb,
  UNAPPROVED_UPLOAD_MAX_FILES,
  UNAPPROVED_UPLOAD_QUOTA_BYTES,
} from '@/lib/brands/upload-limits-format';
import { formatStorageBytes } from '@/lib/brands/storage-quota-format';
import { ShareReviewDialog } from '@/components/brand-studio/share-review-dialog';
import { studioUploadErrorLine } from '@/components/brand-studio/copy';
import { uploadStopNotice } from '@/components/brand-workspace/upload';

describe('upload errors always include live constant numbers (Item 5 & Item 4 UI)', () => {
  it('reads studio image/video/audio MB limits and asset count dynamically in ko and en', () => {
    const imgMb = String(formatLimitMb(STUDIO_LIMITS.imageBytesMax));
    const vidMb = String(formatLimitMb(STUDIO_LIMITS.videoBytesMax));
    const audMb = String(formatLimitMb(STUDIO_LIMITS.audioBytesMax));
    const assetMax = String(STUDIO_LIMITS.assetsPerOrganization);

    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const tooLarge = dict.brandStudio.errors.file_too_large;
      expect(tooLarge).toContain(imgMb);
      expect(tooLarge).toContain(vidMb);
      expect(tooLarge).toContain(audMb);

      const assetLimit = dict.brandStudio.errors.asset_limit;
      expect(assetLimit).toContain(assetMax);
    }
  });

  it('reads brand workspace attachment MB limits dynamically in ko and en', () => {
    expect(BRAND_ATTACHMENT_DISPLAY_LIMITS).toEqual(BRAND_ATTACHMENT_LIMITS);
    const imgMb = String(formatLimitMb(BRAND_ATTACHMENT_LIMITS['image/jpeg']));
    const vidMb = String(formatLimitMb(BRAND_ATTACHMENT_LIMITS['video/mp4']));
    const pdfMb = String(formatLimitMb(BRAND_ATTACHMENT_LIMITS['application/pdf']));

    for (const locale of ['ko', 'en'] as const) {
      const badFile = getDictionary(locale).brandWorkspace.badFile;
      expect(badFile).toContain(imgMb);
      expect(badFile).toContain(vidMb);
      expect(badFile).toContain(pdfMb);
    }
  });

  it('reads room chat and storyboard limits dynamically in ko and en', () => {
    const roomMb = String(formatLimitMb(ROOM_LIMITS.attachmentBytesMax));
    const sbMb = String(formatLimitMb(STORYBOARD_LIMITS.imageBytesMax));

    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      expect(dict.roomsChat.errors.file_too_large).toContain(roomMb);
      expect(dict.roomsChat.composer.tooLarge).toContain(roomMb);
      expect(dict.roomsStoryboard.errors.file_too_large).toContain(sbMb);
      expect(dict.roomsStoryboard.editor.badFile).toContain(sbMb);
    }
  });

  it('explains the 500 MB / 50-file pre-approval cap and that it opens with the plan', () => {
    const quotaMb = String(formatLimitMb(UNAPPROVED_UPLOAD_QUOTA_BYTES));
    const quotaLabelKo = formatStorageBytes(UNAPPROVED_UPLOAD_QUOTA_BYTES, 'ko');
    const maxFiles = String(UNAPPROVED_UPLOAD_MAX_FILES);

    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const studioLine = studioUploadErrorLine(dict.brandStudio, 'storage_quota_exceeded', 'unapproved_quota');
      expect(studioLine).toContain(quotaMb);
      expect(studioLine).toContain(maxFiles);

      const fileLine = studioUploadErrorLine(dict.brandStudio, 'storage_quota_exceeded', 'unapproved_file_limit');
      expect(fileLine).toContain(maxFiles);
      expect(fileLine).toContain(quotaLabelKo);

      const wsLine = uploadStopNotice('storage_quota_exceeded', dict.brandWorkspace, 'unapproved_file_limit').notice;
      expect(wsLine).toContain(maxFiles);
      expect(wsLine).toContain(quotaMb);

      // S5: Consistent single unit (MB, no MiB, no duplicate "500 MB, 500MB"), honest guidance without "confirm your plan" or "Assets" in room copy.
      expect(dict.brandStudio.unapprovedUpload.quotaExceeded).not.toMatch(/500\s*MB,\s*500\s*MB/i);
      expect(dict.brandWorkspace.errors.unapprovedUploadQuota).not.toMatch(/500\s*MB,\s*500\s*MB/i);
      expect(dict.brandWorkspace.uploadHint).not.toContain('MiB');
      expect(dict.roomsChat.errors.unapprovedUploadQuota).not.toMatch(/confirm your plan|in Assets|에셋에서/i);
      expect(dict.roomsChat.errors.unapprovedUploadFiles).not.toMatch(/confirm your plan|in Assets|에셋에서/i);
      expect(dict.roomsStoryboard.errors.unapprovedUploadQuota).not.toMatch(/confirm your plan|in Assets|에셋에서/i);
      expect(dict.roomsStoryboard.errors.unapprovedUploadFiles).not.toMatch(/confirm your plan|in Assets|에셋에서/i);
    }
  });
});

describe('share dialog truth fix (Item 9)', () => {
  it('removes internal path text (/s/...) in both ko and en', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const html = renderToStaticMarkup(
        createElement(ShareReviewDialog, {
          target: { organizationId: '00000000-0000-4000-8000-000000000001', assetId: '00000000-0000-4000-8000-000000000002', title: 'Sample Cut' },
          locale,
          onClose: () => {},
        }),
      );
      expect(html).not.toContain('/s/...');
      expect(html).not.toContain('(/s');
      expect(html).toContain(dict.brandStudio.shareDialog.shareHeading);
    }
  });
});
