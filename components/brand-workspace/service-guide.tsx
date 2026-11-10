import type { Dictionary } from "@/messages/en";
import { scopedHref } from "@/lib/brands/workspace/selection";

export function ServiceGuide({
  kind,
  b,
  showOther = true,
  studioAllowed = true,
  organizationId,
}: {
  kind: "campaign" | "studio";
  b: Dictionary["brandWorkspace"];
  /** Off when the other service's entry would only lead to a page this account cannot use. */
  showOther?: boolean;
  /** False when the organization's feature policy closes generative studio production. */
  studioAllowed?: boolean;
  organizationId?: string;
}) {
  const t = b.serviceGuide[kind];
  const isEn = !/[가-힣]/.test(b.serviceGuide.label);
  return (
    <section className="bw-service-guide ys-service-guide" aria-label={b.serviceGuide.label} data-brand-service={kind}>
      <div className="ys-track-split" data-track-cards>
        {studioAllowed && (
          <div className="ys-track-card" data-track="studio" data-active={kind === "studio" ? "true" : undefined}>
            <div className="ys-track-card-top">
              <span className="ys-track-pill" data-track="studio">
                {isEn ? "YAGI PRODUCTION · Studio Film" : "YAGI PRODUCTION · 스튜디오 제작"}
              </span>
              <span className="ys-track-ratio">2.39:1 · 16:9 · 9:16</span>
            </div>
            <strong>
              {isEn
                ? "YAGI directs and produces your brand film"
                : "브랜드 필름을 YAGI가 직접 만듭니다"}
            </strong>
            <p>
              {isEn
                ? "Drop PPTs, Figma links, or chat memos. We structure the shooting brief and deliver the final master cut."
                : "정리 안 된 PPT·피그마·카톡 메모를 그대로 올리면 AI가 명세서로 정리하고, YAGI 디렉터가 마스터 필름을 납품합니다."}
            </p>
          </div>
        )}
        <div className="ys-track-card" data-track="creator" data-active={kind === "campaign" ? "true" : undefined}>
          <div className="ys-track-card-top">
            <span className="ys-track-pill" data-track="creator">
              {isEn ? "CREATOR CAMPAIGN · Creator Seeding" : "CREATOR CAMPAIGN · 인플루언서 게시"}
            </span>
            <span className="ys-track-ratio">4:5 · 9:16 Reels · TikTok</span>
          </div>
          <strong>
            {studioAllowed
              ? isEn
                ? "Creators publish in their own likeness on their channels"
                : "인플루언서가 자기 얼굴로 본인 계정에 올립니다"
              : isEn
                ? "Verified creators publish campaign content on their channels"
                : "검증된 크리에이터가 본인 계정에 캠페인 콘텐츠를 게시합니다"}
          </strong>
          <p>
            {studioAllowed
              ? isEn
                ? "Recruit verified creators, generate format-locked videos, and track live views, likes, saves, and secondary ad rights."
                : "검증된 크리에이터 모집부터 포맷 영상 생성, 게시 링크·조회수·저장수 실시간 집계, 2차 광고 활용까지 한곳에서 관리합니다."
              : isEn
                ? "Review verified creator candidates, track live views, likes, saves, and manage secondary ad rights in one place."
                : "검증된 크리에이터 후보 검토부터 게시 링크·조회수·저장수 실시간 집계, 2차 광고 활용까지 한곳에서 관리합니다."}
          </p>
        </div>
      </div>
      <div className="bw-service-intro">
        <h2>{t.lead}</h2>
        <p>{t.body}</p>
      </div>
      <dl>
        <div><dt>{t.scopeLabel}</dt><dd>{t.scope}</dd></div>
        <div><dt>{t.termsLabel}</dt><dd>{t.terms}</dd></div>
      </dl>
      {showOther && (kind !== "campaign" || studioAllowed) && (
        <a href={scopedHref(kind === "campaign" ? "/brand/studio" : "/brand/projects/new", organizationId ? { id: organizationId } : null)}>{t.other}</a>
      )}
    </section>
  );
}
