import type { StudioErrorCode } from '@/lib/brand-studio/contracts';
import type { ComposeAspect, ComposerProject } from '@/lib/brand-studio/compose/timeline';

export const VIDEO_PROJECT_STATUSES = ['active', 'completed', 'archived'] as const;
export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

/**
 * `bgm.set` and `sfx.add` put an organization audio asset into a project's background-music slot or onto its
 * effects track (docs/BRAND-SOUND-STUDIO.md §7.3). They exist only while `BRAND_SOUND_STUDIO=on` and the
 * `sound` group is open; otherwise they answer like an unknown operation (`invalid`) or a closed feature.
 */
export const VIDEO_PROJECT_OPERATIONS = ['create', 'save', 'status', 'delete', 'bgm.set', 'sfx.add'] as const;
export type VideoProjectOperation = (typeof VIDEO_PROJECT_OPERATIONS)[number];

export interface VideoProjectSummary {
  id: string;
  organizationId: string;
  title: string;
  status: VideoProjectStatus;
  aspect: ComposeAspect;
  revision: number;
  clipCount: number;
  durationSec: number;
  thumbUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The brand project this film is filed in (null = 미분류). Present only while the brand project spine is open
   * for the organization (`BRAND_PROJECT_SPINE`, migration 0194); absent, the answer is exactly as before.
   */
  brandProjectId?: string | null;
}

export interface VideoProjectDetail extends VideoProjectSummary {
  timeline: ComposerProject;
}

export type VideoProjectListResult =
  | {
      ok: true;
      projects: VideoProjectSummary[];
      project: VideoProjectDetail | null;
      canCreate: boolean;
    }
  | {
      ok: false;
      code: StudioErrorCode;
    };

export type VideoProjectMutationResult =
  | {
      ok: true;
      created?: boolean;
      project?: VideoProjectDetail;
      deletedProjectId?: string;
      purgedShotSheetAssetIds?: string[];
    }
  | {
      ok: false;
      code: StudioErrorCode;
      currentRevision?: number;
      /** `bgm.set` without `replace` on a project whose slot already holds other music: what is there now. */
      currentBgmLabel?: string;
      /** `sfx.add` on a project whose effects track is full. */
      sfxFull?: boolean;
    };
