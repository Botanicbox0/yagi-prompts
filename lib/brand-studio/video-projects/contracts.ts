import type { StudioErrorCode } from '@/lib/brand-studio/contracts';
import type { ComposeAspect, ComposerProject } from '@/lib/brand-studio/compose/timeline';

export const VIDEO_PROJECT_STATUSES = ['active', 'completed', 'archived'] as const;
export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export const VIDEO_PROJECT_OPERATIONS = ['create', 'save', 'status', 'delete'] as const;
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
    };
