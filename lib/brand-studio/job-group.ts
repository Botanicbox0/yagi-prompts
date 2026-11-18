/**
 * `job.create_group`: one request on two or three image models at once (founder 2026-11-19: "이미지 모델을
 * 2개 이상을 동시 선택해서 만드는 것도 가능하게 … 각 프롬프트별 로직이 따로 들어가서 이미지가 2장이 나오게").
 *
 * The group is N ordinary image jobs, one per model, created in ONE transaction: seat -> organization row
 * lock -> idempotency -> every model still offered -> every plan (the same `planJob` a single run uses, so
 * each run is validated and priced exactly as if it had been sent alone) -> open-run ceiling for all N ->
 * allowance for the SUM -> N inserts. Any refusal leaves nothing behind. Each job keeps its own request id
 * (`groupRunRequestId`), its own model and therefore its own Prompt Architect profile, and runs, settles,
 * fails and refunds on its own exactly as today: one model failing never touches the others. The jobs
 * share `params.group = { id, models }` (jsonb, no migration).
 */
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import {
  ImageJobGroupSchema,
  STUDIO_LIMITS,
  groupRunRequestId,
  type StudioFailure,
  type StudioJobGroupCreated,
} from './contracts';
import { lockOrganization, requireCreate, studioSeat, StudioDenied } from './access';
import { insertJob } from './jobs';
import { selectableModels, studioModel } from './models';
import { planJob, type JobPlan } from './plan';
import { jobView, openJobCount } from './repo';
import type { JobRow, OutputRow, StudioDeps } from './types';
import { reserveAllowance } from './usage';
import { projectForNewJob, studioProjectsReady } from './job-projects';
import { failure, guarded } from './outcome';

/**
 * Why a model of a group cannot run now, or null when it can: a model no screen offers any more (taken
 * off the list, retired, waiting for its provider) is `model_unavailable`; a name that is not an image
 * model at all is a malformed request (`invalid`).
 */
export function groupModelProblem(id: string): 'model_unavailable' | 'invalid' | null {
  const model = studioModel(id);
  if (!model || model.medium !== 'image') return 'invalid';
  return selectableModels('image').some((m) => m.id === id) ? null : 'model_unavailable';
}

export async function createStudioJobGroup(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioJobGroupCreated | StudioFailure> {
  const parsed = ImageJobGroupSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale = viewer.locale === 'en' ? 'en' : 'ko';
  const models = v.runs.map((run) => run.model);
  const requestIds = models.map((model) => groupRunRequestId(v.requestId, model));
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId);
      requireCreate(seat);
      await lockOrganization(sql, v.organizationId);

      // The same group again (a lost answer, a second press): the same N jobs, nothing new.
      const prior = (
        await sql.query<JobRow>(
          'select * from brand_studio_jobs where organization_id = $1 and created_by = $2 and request_id = any($3::text[])',
          [v.organizationId, seat.userId, requestIds],
        )
      ).rows;
      if (prior.length) {
        const byKey = new Map(prior.map((row) => [row.request_id, row]));
        const rows = requestIds.map((key) => byKey.get(key));
        const groupId = rows[0]?.params?.group?.id;
        const same = rows.every((row) => row && row.kind === 'image' && row.params?.group?.id === groupId && Boolean(groupId));
        if (!same || prior.length !== requestIds.length) throw new StudioDenied('conflict');
        const outputs = (await sql.query<OutputRow>('select * from brand_studio_outputs where job_id = any($1::uuid[])', [rows.map((row) => row!.id)])).rows;
        return { ok: true as const, groupId: groupId!, jobs: rows.map((row) => jobView(row!, outputs, deps.media)) };
      }

      // Every model must still be one the screen offers; one that is not stops the whole group.
      for (const model of models) {
        const problem = groupModelProblem(model);
        if (problem) throw new StudioDenied(problem);
      }

      // Each run is planned exactly as a single run with the same fields would be (validation, references,
      // reviewed sentence, quality for the models that have one, price).
      const plans: JobPlan[] = [];
      for (const [i, run] of v.runs.entries()) {
        plans.push(
          await planJob(
            sql,
            v.organizationId,
            {
              kind: 'image',
              organizationId: v.organizationId,
              requestId: requestIds[i]!,
              model: run.model,
              prompt: v.prompt,
              enhance: v.enhance,
              ...(run.reviewedPrompt ? { reviewedPrompt: run.reviewedPrompt } : {}),
              references: v.references,
              ...(v.projectId ? { projectId: v.projectId } : {}),
              aspect: v.aspect,
              resolution: v.resolution,
              count: v.count,
              ...(run.quality ? { quality: run.quality } : {}),
              ...(v.background ? { background: v.background } : {}),
            },
            deps.media,
            locale,
            { regionV2: deps.env.regionV2 },
          ),
        );
      }

      // The whole group fits under the open-run ceiling, or none of it starts.
      if ((await openJobCount(sql, v.organizationId)) + plans.length > STUDIO_LIMITS.openJobsPerOrganization) throw new StudioDenied('too_many_running');
      // The allowance is checked for the sum: the button showed the sum, and every run reserves its own share.
      const total = plans.reduce((sum, plan) => sum + plan.estimateKrw, 0);
      const verdict = await reserveAllowance(sql, v.organizationId, total, deps.env, deps.now?.() ?? new Date());
      if (!verdict.ok) throw new StudioDenied(verdict.code);

      const projectId = (await studioProjectsReady(deps, sql))
        ? await projectForNewJob(sql, v.organizationId, { requested: v.projectId ?? null, parentOutputId: null, fill: false })
        : null;
      const groupId = randomUUID();
      const jobs = [];
      for (const [i, plan] of plans.entries()) {
        const grouped: JobPlan = { ...plan, params: { ...plan.params, group: { id: groupId, models: [...models] } } };
        jobs.push(await insertJob(deps, sql, seat.userId, v.organizationId, requestIds[i]!, grouped, projectId));
      }
      return { ok: true as const, groupId, jobs };
    }),
  );
}
