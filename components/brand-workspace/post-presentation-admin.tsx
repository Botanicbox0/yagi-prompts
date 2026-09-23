import type { BrandAttachment, BrandPost } from "@/lib/brands/workspace/types";
import { BRAND_COVER_MIMES } from "@/lib/brands/workspace/schemas";
import { postPresentation, postShortId } from "@/lib/brands/workspace/performance";
import type { BrandCopy } from "./action-form";
import { ManagedForm } from "./managed-form";
import { BrandUpload } from "./upload";

const koreaInput = (iso: string | null) => iso ? new Date(+new Date(iso) + 9 * 3600000).toISOString().slice(0, 16) : "";

/**
 * Studio-only: what each post card shows the client. Thumbnails are chosen from this campaign's own
 * uploaded images; nothing is fetched from the post link. Every field may stay blank (unknown). The form
 * carries `presentation.revision` only, so it can never overwrite or move a metric.
 */
export function PostPresentationAdmin({ projectId, posts, attachments, b }: { projectId: string; posts: BrandPost[]; attachments: BrandAttachment[]; b: BrandCopy }) {
  const t = b.postPresentation;
  const images = attachments.filter(a => (BRAND_COVER_MIMES as readonly string[]).includes(a.mime));
  return (
    <section className="bw-panel" id="post-presentation" data-post-presentation>
      <h2>{t.title}</h2>
      <p className="bw-note">{t.hint}</p>
      <p className="bw-muted">{t.uploadHint} {t.reportNote}</p>
      <BrandUpload projectId={projectId} b={b} studio />
      {posts.length === 0 ? <p className="bw-muted">{b.noPosts}</p> : (
        <div className="bw-presentation-list">
          {posts.map((post, index) => {
            const v = postPresentation(post);
            const name = `${b.platforms[post.platform]} ${index + 1} · ${postShortId(post.url)}`;
            return (
              <details key={post.id} className="bw-presentation-item" data-presentation-row={post.id}>
                <summary>
                  <span className="bw-presentation-thumb">{v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" /> : null}</span>
                  <span><strong>{v.handle ? `@${v.handle}` : name}</strong><small className="bw-muted">{v.handle ? name : t.none}</small></span>
                </summary>
                <p><a href={post.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">{post.url} ↗</a></p>
                <ManagedForm op="brandWorkspace.postPresentation" b={b} submit={t.save}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="expectedRevision" value={v.revision} />
                  <fieldset className="bw-cover-options bw-thumb-options">
                    <legend>{t.thumbnail}</legend>
                    {images.length === 0 && <p className="bw-muted">{t.noImages}</p>}
                    {images.map(a => {
                      const url = `/api/brand-workspace/attachments/${a.id}`;
                      return <label key={a.id}><input type="radio" name="thumbnailAttachmentId" value={a.id} defaultChecked={v.thumbnailUrl === url} /><img src={url} alt={a.name} loading="lazy" /><span className="bw-prose">{a.name}</span></label>;
                    })}
                    <label><input type="radio" name="thumbnailAttachmentId" value="" defaultChecked={!v.thumbnailUrl} />{t.none}</label>
                  </fieldset>
                  <div className="bw-grid">
                    <label>{t.handle}<input name="handle" defaultValue={v.handle ?? ""} maxLength={51} autoComplete="off" spellCheck={false} pattern="@?[\p{L}\p{N}._\-]{1,50}" /><span className="bw-muted">{t.handleHint}</span></label>
                    <label>{t.displayName}<input name="displayName" defaultValue={v.displayName ?? ""} maxLength={80} autoComplete="off" /></label>
                  </div>
                  <div className="bw-grid">
                    <label>{t.followers}<input name="followers" type="number" inputMode="numeric" min={0} step={1} defaultValue={v.followers ?? ""} placeholder={b.notMeasured} /><span className="bw-muted">{t.followersHint}</span></label>
                    <label>{t.followersSource}<select name="followersSource" defaultValue={v.followersSource ?? "studio_review"}><option value="studio_review">{b.sourceLabels.studio_review}</option><option value="creator_evidence">{b.sourceLabels.creator_evidence}</option></select></label>
                    <label>{t.followersMeasuredAt} · {b.koreaTime}<input name="followersMeasuredAt" type="datetime-local" defaultValue={koreaInput(v.followersMeasuredAt)} /></label>
                  </div>
                  <label className="bw-check"><input type="checkbox" name="followersApproximate" value="true" defaultChecked={v.followersApproximate} />{t.followersApproximate}</label>
                </ManagedForm>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
