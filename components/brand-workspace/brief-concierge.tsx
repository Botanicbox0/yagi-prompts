"use client";

import { useState } from "react";

export type FieldSource = "argon" | "user" | "director_default" | "human_pd";
export type FieldStatus = "filled" | "assumed" | "open" | "deferred" | "confirmed";

type GapQuestion = {
  key: string;
  sectionKo: string;
  sectionEn: string;
  questionKo: string;
  questionEn: string;
  whyKo: string;
  whyEn: string;
  argonEvidenceKo: string;
  argonEvidenceEn: string;
  directorDefaultKo: string;
  directorDefaultEn: string;
  options: readonly {
    id: string;
    ko: string;
    en: string;
  }[];
};

const GAP_QUESTIONS: readonly GapQuestion[] = [
  {
    key: "edit.cutPace",
    sectionKo: "편집 리듬",
    sectionEn: "Editing Rhythm",
    questionKo: "컷은 얼마나 빨리 넘어갈까요?",
    questionEn: "How fast should the cuts move?",
    whyKo: "같은 15초라도 컷 5개와 18개는 촬영·생성 분량과 호흡이 완전히 달라집니다.",
    whyEn: "A 15s spot with 5 cuts vs 18 cuts requires a completely different shot density.",
    argonEvidenceKo: "기획서 슬라이드 7p '초반 숏폼 텐션 강조' 문구를 근거로 추천했어요",
    argonEvidenceEn: "Inferred from Slide 7 ('fast short-form hook tension')",
    directorDefaultKo: "도입 2초 빠른 훅(0.8초 컷) 후 본문 2.5초 에디토리얼 호흡 (YAGI 디렉터 기본값)",
    directorDefaultEn: "Fast 0.8s hook entry followed by 2.5s editorial cadence (YAGI Default)",
    options: [
      { id: "fast", ko: "빠르게 — 1초 안팎, 숏폼 리듬", en: "Fast — ~1s short-form cuts" },
      { id: "medium", ko: "보통 — 2~3초마다 안정적인 전환", en: "Medium — 2–3s balanced cuts" },
      { id: "slow", ko: "느리게 — 한 장면을 오래 보여주는 필름 톤", en: "Slow — lingering cinema film tone" },
      { id: "mixed", ko: "섞어서 — 도입은 빠르게, 후반은 여유 있게", en: "Mixed — fast hook, lingering payoff" },
    ],
  },
  {
    key: "guardrails.forbiddenPhrases",
    sectionKo: "금지·심의 가드레일",
    sectionEn: "Brand & Legal Guardrails",
    questionKo: "절대 쓰면 안 되는 표현이나 연출이 있나요?",
    questionEn: "Are there any forbidden phrases or visual taboos?",
    whyKo: "심의나 브랜드 가이드에 걸리는 표현은 시안 제작 전에 빼야 재작업이 없습니다.",
    whyEn: "Catching compliance and brand taboos upfront prevents costly re-renders.",
    argonEvidenceKo: "첨부 기획서에 심의 금지어 항목이 비어 있어 확인이 필요해요",
    argonEvidenceEn: "No compliance guardrails were found in the uploaded deck",
    directorDefaultKo: "과장 효능·최상급 단정 표현 제외 및 표준 표시광고 가이드 준수",
    directorDefaultEn: "Exclude absolute efficacy claims; follow standard ad compliance",
    options: [
      { id: "efficacy", ko: "효능·효과를 단정하는 표현 금지", en: "No guaranteed efficacy claims" },
      { id: "price", ko: "가격·할인율 직접 언급 금지", en: "No direct price/discount mention" },
      { id: "none", ko: "특별한 금지 표현 없음", en: "No special restrictions" },
    ],
  },
  {
    key: "guardrails.competitors",
    sectionKo: "경쟁사 배제",
    sectionEn: "Competitor Exclusion",
    questionKo: "비교하거나 연상돼서는 안 되는 브랜드·컬러가 있나요?",
    questionEn: "Any competitor brands or signature colors to avoid?",
    whyKo: "색감·구도·오브제가 경쟁 브랜드를 떠올리게 하면 통째로 다시 찍어야 합니다.",
    whyEn: "Avoiding competitor color/prop cues prevents brand confusion.",
    argonEvidenceKo: "피그마 무드보드에서 쿨블루 톤 제외 메모를 감지했어요",
    argonEvidenceEn: "Detected note excluding cool-blue competitor tones in Figma board",
    directorDefaultKo: "동종 카테고리 상위 3사 키 컬러 및 유사 패키지 실루엣 배제",
    directorDefaultEn: "Exclude top-3 category competitor key colors and bottle silhouettes",
    options: [
      { id: "color_exclude", ko: "경쟁사 시그니처 컬러·구도 배제", en: "Exclude competitor key colors & angles" },
      { id: "none", ko: "없음 (자유롭게 연출)", en: "None (open direction)" },
    ],
  },
  {
    key: "rights.paidAds",
    sectionKo: "권리·매체 집행",
    sectionEn: "Paid Media & Rights",
    questionKo: "이 영상으로 유료 광고(메타·틱톡·유튜브 등)도 돌리나요?",
    questionEn: "Will this video run as paid media (Meta, TikTok, YouTube)?",
    whyKo: "유료 광고 집행 여부에 따라 인물 초상권·음원 라이선스 범위와 컷다운 비율이 달라집니다.",
    whyEn: "Paid media requires commercial audio/likeness clearance and aspect cutdowns.",
    argonEvidenceKo: "카톡 메모의 '릴스 부스팅 예정' 문구를 근거로 읽었어요",
    argonEvidenceEn: "Inferred from memo mention of 'Reels paid boosting'",
    directorDefaultKo: "자사 SNS 오가닉 + 메타/틱톡 유료 광고 3개월 상업 라이선스 기준 설계",
    directorDefaultEn: "Design for organic social + 3-month paid social ad clearance",
    options: [
      { id: "yes", ko: "네, 브랜드 계정 유료 광고까지 집행", en: "Yes, including paid brand ads" },
      { id: "no", ko: "아니요, 브랜드 채널 오가닉 게시만", en: "No, organic brand channel only" },
      { id: "seeding", ko: "인플루언서 시딩 + 파트너십 광고까지 고려", en: "Considering creator seeding + partnership ads" },
    ],
  },
  {
    key: "sound.narration",
    sectionKo: "사운드·보이스",
    sectionEn: "Sound & Voiceover",
    questionKo: "성우 목소리(나레이션)나 텍스트 자막은 어떻게 넣을까요?",
    questionEn: "How should we handle voiceover and captions?",
    whyKo: "나레이션 유무에 따라 컷 호흡과 사운드 디자인(BGM/폴리 사운드) 구조가 바뀝니다.",
    whyEn: "Voiceover determines shot pacing and soundscape architecture.",
    argonEvidenceKo: "레퍼런스 영상이 BGM + 앰비언트 사운드 중심이어서 기본값으로 잡았어요",
    argonEvidenceEn: "Reference reel uses BGM + tactile SFX without narration",
    directorDefaultKo: "나레이션 없이 시네마틱 사운드 디자인 + 클린 타이포 자막본 별도 납품",
    directorDefaultEn: "Cinematic BGM + tactile SFX (deliver both clean master & captioned cut)",
    options: [
      { id: "none", ko: "나레이션 없음 (음악·현장음 + 타이포 자막만)", en: "No VO (BGM + SFX + clean typography)" },
      { id: "vo_female", ko: "차분하고 세련된 여성 보이스오버", en: "Calm editorial female voiceover" },
      { id: "vo_male", ko: "낮고 신뢰감 있는 남성 보이스오버", en: "Low cinematic male voiceover" },
    ],
  },
  {
    key: "schedule.desiredDelivery",
    sectionKo: "희망 납기",
    sectionEn: "Target Delivery",
    questionKo: "첫 시안(v1)과 최종본은 언제까지 받아야 하나요?",
    questionEn: "When do you need Cut v1 and final delivery?",
    whyKo: "납기 일정에 맞춰 시사 라운드 횟수와 YAGI 디렉터·GPU 렌더 파이프라인을 배정합니다.",
    whyEn: "Delivery timing sets our review cadence and render queue priority.",
    argonEvidenceKo: "기획서 내 런칭 일정표를 기준으로 2주 이내 납기를 추천했어요",
    argonEvidenceEn: "Estimated 2-week window from launch calendar in deck",
    directorDefaultKo: "명세서 확정 후 D+4 첫 시안(v1) 시사 → 피드백 반영 후 D+10 최종 마스터 납품",
    directorDefaultEn: "Cut v1 in D+4 after spec lock → Final master in D+10",
    options: [
      { id: "twoWeeks", ko: "2주 안에 (D+4 첫 시안 시사)", en: "Within 2 weeks (Cut v1 in D+4)" },
      { id: "urgent", ko: "1주일 이내 패스트트랙 희망", en: "Urgent 1-week fast-track" },
      { id: "month", ko: "한 달 안에 여유 있게 진행", en: "Within 1 month (flexible)" },
    ],
  },
] as const;

type AnswerRecord = {
  status: "assumed" | "confirmed" | "deferred";
  source: FieldSource;
  selectedId: string;
  customText: string;
};

const SAMPLE_CHAOS_MEMO_KO = `[팀 회의 메모]
이번 AW 시즌 신제품 세럼 + 브랜드 필름 건입니다!
- 첨부 1: 2026_AW_브랜드캠페인_기획안_초안_v4.pptx (34장)
- 피그마 보드: https://www.figma.com/file/yagi-aw-moodboard (Hero 프레임 참고)
- 팀 메모: "기존 화장품 광고처럼 뻔하게 모델이 웃으면서 바르는 거 말고, 파리 아틀리에 아침 채광 느낌으로 감도 있게 뽑고 싶어요. 릴스 부스팅 광고도 돌릴 거라 초반 2초에 무조건 시선 잡혀야 함! 경쟁사 쿨블루 톤은 절대 피해주세요. 나레이션 넣을지 말지는 아직 내부에서 반반인데 디렉터님이 보시기에 더 감도 높은 쪽으로 추천 부탁드려요."`;

const SAMPLE_CHAOS_MEMO_EN = `[Team Meeting Notes]
Attaching our AW serum launch deck (34 slides) + Figma moodboard (https://www.figma.com/file/yagi-aw-moodboard).
Notes from CMO: "Avoid cliché smiling beauty ads. We want warm Paris atelier morning light with a scroll-stopping 2-second hook for Reels boosting. Avoid cool-blue competitor tones. Still undecided on voiceover—open to the Director's recommendation."`;

export function BriefConcierge({
  brandName,
  projectTitle,
  objective,
  organizationId,
  projectId,
  locale,
}: {
  brandName: string;
  projectTitle: string;
  objective: string;
  organizationId?: string;
  projectId?: string;
  locale: string;
}) {
  const isKo = locale === "ko";
  const [activeStage, setActiveStage] = useState<
    "intake" | "interview" | "spec" | "share"
  >("intake");
  const [deliverableKind, setDeliverableKind] = useState<
    "film" | "product" | "template" | "unknown"
  >("film");
  const [rawMemo, setRawMemo] = useState<string>("");
  const [linkInput, setLinkInput] = useState<string>("");
  const [links, setLinks] = useState<string[]>([
    "https://www.figma.com/file/yagi-studio-moodboard",
  ]);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([
    "Brand_Campaign_Deck_Draft.pptx",
    "Product_Key_Visual_Guide.pdf",
  ]);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [specVersion, setSpecVersion] = useState<number>(1);
  const [whyOpenKey, setWhyOpenKey] = useState<string | null>(null);
  const [submittedNotice, setSubmittedNotice] = useState<boolean>(false);
  const [sharePreviewOpen, setSharePreviewOpen] = useState<boolean>(false);
  const [shareLinkCopied, setShareLinkCopied] = useState<boolean>(false);

  const [answers, setAnswers] = useState<Record<string, AnswerRecord>>(() => {
    const init: Record<string, AnswerRecord> = {};
    for (const q of GAP_QUESTIONS) {
      init[q.key] = {
        status: "assumed",
        source: "argon",
        selectedId: q.options[0]!.id,
        customText: "",
      };
    }
    return init;
  });

  const loadSampleChaos = () => {
    setRawMemo(isKo ? SAMPLE_CHAOS_MEMO_KO : SAMPLE_CHAOS_MEMO_EN);
    if (!droppedFiles.includes("AW_Launch_Chaos_Brief_34p.pptx")) {
      setDroppedFiles((prev) => ["AW_Launch_Chaos_Brief_34p.pptx", ...prev]);
    }
  };

  const addLink = () => {
    const trimmed = linkInput.trim();
    if (!trimmed) return;
    setLinks((prev) => [...prev, trimmed]);
    setLinkInput("");
  };

  const runArgonAnalysis = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      setActiveStage("interview");
    }, 450);
  };

  const selectOption = (key: string, optionId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        status: "confirmed",
        source: "user",
        selectedId: optionId,
        customText: prev[key]?.customText ?? "",
      },
    }));
  };

  const deferToDirector = (key: string) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        status: "deferred",
        source: "director_default",
        selectedId: "deferred",
        customText: "",
      },
    }));
  };

  const setCustomAnswer = (key: string, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        status: "confirmed",
        source: "user",
        selectedId: "custom",
        customText: text,
      },
    }));
  };

  const resolveAnswerText = (q: GapQuestion): string => {
    const rec = answers[q.key];
    if (!rec) return isKo ? q.options[0]!.ko : q.options[0]!.en;
    if (rec.status === "deferred") {
      return isKo ? q.directorDefaultKo : q.directorDefaultEn;
    }
    if (rec.selectedId === "custom" && rec.customText.trim()) {
      return rec.customText.trim();
    }
    const found = q.options.find((o) => o.id === rec.selectedId) ?? q.options[0]!;
    return isKo ? found.ko : found.en;
  };

  const confirmedCount = Object.values(answers).filter(
    (a) => a.status === "confirmed",
  ).length;
  const deferredCount = Object.values(answers).filter(
    (a) => a.status === "deferred",
  ).length;
  const argonCount =
    4 +
    Object.values(answers).filter((a) => a.status === "assumed").length;

  const submitSpecSheetToStudio = async () => {
    const lines = GAP_QUESTIONS.map((q) => {
      const rec = answers[q.key];
      const tag =
        rec?.status === "deferred"
          ? isKo
            ? "[디렉터 추천 위임]"
            : "[Director Recommended]"
          : rec?.source === "user"
            ? isKo
              ? "[브랜드 확정]"
              : "[Brand Confirmed]"
            : isKo
              ? "[기획서 자동 추출]"
              : "[Auto-Extracted]";
      return `- ${isKo ? q.sectionKo : q.sectionEn}: ${resolveAnswerText(q)} ${tag}`;
    });

    const payload = [
      `[YAGI PRODUCTION 제작 명세서 v${specVersion} 확정]`,
      `구분: ${deliverableKind === "film" ? "캠페인 필름" : deliverableKind === "product" ? "제품 영상" : deliverableKind === "template" ? "전용 템플릿" : "맞춤 제작"}`,
      `분석 자료: 파일 ${droppedFiles.length}개 · 링크 ${links.length}개`,
      ...lines,
      rawMemo.trim() ? `원문 메모 발췌: ${rawMemo.trim().slice(0, 240)}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (projectId) {
        await fetch("/api/brand-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "message.send",
            input: {
              projectId,
              body: payload,
              requestId:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : String(Date.now()),
            },
          }),
        });
      } else if (organizationId) {
        await fetch("/api/brand-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "support.send",
            input: {
              organizationId,
              body: payload,
              requestId:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : String(Date.now()),
            },
          }),
        });
      }
    } catch {
      // Keep interactive preview responsive
    }

    if (typeof document !== "undefined") {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '#conversation textarea[name="body"]',
      );
      if (textarea) {
        textarea.value = payload;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    setSubmittedNotice(true);
    setSpecVersion((v) => v + 1);
    setTimeout(() => setSubmittedNotice(false), 3200);
  };

  const copyViralPreviewCardLink = () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://brand.twings.app";
    const shareUrl = `${origin}/brand/projects/${projectId ?? "preview"}?card=yagi-production-deck#brief`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setShareLinkCopied(true);
    setTimeout(() => setShareLinkCopied(false), 2600);
  };

  return (
    <div className="ys-brief-concierge" data-brief-intake data-spec-sheet>
      <header className="ys-concierge-header">
        <div>
          <div className="ys-concierge-badges">
            <span className="ys-kicker-badge ys-badge-gold">
              {isKo ? "YAGI PRODUCTION · AI 크리에이티브 프로듀서" : "YAGI PRODUCTION · AI Creative Producer"}
            </span>
            <span className="ys-engine-chip">
              {isKo ? "자동 브리프 정리 · 전담 디렉터 검토" : "Smart Brief Intake · Director Review"}
            </span>
          </div>
          <h3>
            {isKo
              ? "정리하지 말고, 다 주세요 — 디렉터가 읽고 빠진 것만 묻습니다"
              : "Don't format a brief — drop your raw decks, Figma & memos. We ask only what's missing."}
          </h3>
          <p className="bw-muted">
            {isKo
              ? "PPT, PDF, 피그마 링크, 정리되지 않은 회의 메모까지 그대로 넣어주세요. 시각 무드와 기획 의도를 자동으로 정리하고, 비어 있는 핵심 항목만 골라 여쭤본 뒤 버전별 제작 명세서로 기록합니다."
              : "Drop slides, Figma links, or raw meeting notes. We extract visual mood and intent, ask only for the missing pieces, and save everything as a versioned Production Spec Sheet."}
          </p>
        </div>

        {/* 4-Stage Step Switcher */}
        <div className="ys-concierge-steps" role="tablist" aria-label={isKo ? "프로덕션 의뢰 단계" : "Production brief stages"}>
          <button
            type="button"
            role="tab"
            aria-selected={activeStage === "intake"}
            className={activeStage === "intake" ? "ys-cstep ys-cstep-active" : "ys-cstep"}
            onClick={() => setActiveStage("intake")}
          >
            <span>01</span> {isKo ? "자료 통째 투하" : "Chaos-In Intake"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeStage === "interview"}
            className={activeStage === "interview" ? "ys-cstep ys-cstep-active" : "ys-cstep"}
            onClick={() => setActiveStage("interview")}
          >
            <span>02</span> {isKo ? `빈칸 역질문 (${GAP_QUESTIONS.length})` : `Gap Interview (${GAP_QUESTIONS.length})`}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeStage === "spec"}
            className={activeStage === "spec" ? "ys-cstep ys-cstep-active" : "ys-cstep"}
            onClick={() => setActiveStage("spec")}
          >
            <span>03</span> {isKo ? `제작 명세서 v${specVersion}` : `Spec Sheet v${specVersion}`}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeStage === "share"}
            className={activeStage === "share" ? "ys-cstep ys-cstep-active" : "ys-cstep"}
            onClick={() => setActiveStage("share")}
          >
            <span>04</span> {isKo ? "프리뷰 카드 공유" : "Share Brief Card"}
          </button>
        </div>
      </header>

      {/* STAGE 01: Chaos-In Intake */}
      {activeStage === "intake" && (
        <div className="ys-cstage-body" data-concierge-stage="intake">
          <div className="ys-intake-top-bar">
            <div className="ys-kind-pills" role="group" aria-label={isKo ? "이번 건의 종류" : "Deliverable type"}>
              {(
                [
                  ["film", isKo ? "브랜드·캠페인 필름" : "Brand & Campaign Film"],
                  ["product", isKo ? "제품 히어로 영상" : "Product Hero Spot"],
                  ["template", isKo ? "반복 제작용 전용 템플릿" : "Repeatable Brand Template"],
                  ["unknown", isKo ? "아직 모름 (디렉터 추천)" : "Not sure yet"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={deliverableKind === id ? "ys-kind-pill ys-kind-pill-on" : "ys-kind-pill"}
                  aria-pressed={deliverableKind === id}
                  onClick={() => setDeliverableKind(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ys-sample-fill-btn"
              onClick={loadSampleChaos}
            >
              {isKo ? "예시 기획서·카톡 메모 넣기" : "Load sample messy deck & memo"}
            </button>
          </div>

          <div className="ys-intake-grid">
            <div className="ys-intake-box">
              <strong>
                {isKo
                  ? "01. 기획서·피그마·레퍼런스 링크 & 파일"
                  : "01. Slides (PPT/PDF), Figma & Reference Links"}
              </strong>
              <p className="bw-muted">
                {isKo
                  ? "PDF · PPTX · KEY · MP4 · 피그마 · 노션 · 구글 드라이브 링크를 정리 없이 한꺼번에 올리세요."
                  : "Drop PDF, PPTX, KEY, MP4, Figma, Notion, or Drive links without organizing them."}
              </p>
              <div className="ys-asset-pills">
                {droppedFiles.map((file) => (
                  <span key={file} className="ys-asset-pill">
                    <span>{file}</span>
                    <small style={{ marginLeft: 6, opacity: 0.75 }}>{isKo ? "· 분석 완료" : "· Parsed"}</small>
                  </span>
                ))}
                {links.map((url) => (
                  <span key={url} className="ys-asset-pill ys-asset-pill-link">
                    {url}
                  </span>
                ))}
              </div>
              <div className="ys-link-adder">
                <input
                  type="url"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.currentTarget.value)}
                  placeholder={
                    isKo
                      ? "피그마, 노션, 구글 드라이브, 인스타·유튜브 링크 붙여넣기"
                      : "Paste Figma, Notion, Drive, IG or YouTube URL"
                  }
                  aria-label={isKo ? "참고 링크 추가" : "Add reference link"}
                />
                <button type="button" className="bw-button" onClick={addLink}>
                  {isKo ? "+ 링크 추가" : "+ Add Link"}
                </button>
              </div>
            </div>

            <div className="ys-intake-box">
              <strong>
                {isKo
                  ? "02. 정리되지 않은 회의·팀 메모 그대로 붙여넣기"
                  : "02. Paste raw team or meeting notes as-is"}
              </strong>
              <p className="bw-muted">
                {isKo
                  ? "팀원들과 주고받은 말뭉치나 회의 메모를 그대로 붙여 넣으시면 목표·타깃·주의사항으로 자동 분류합니다."
                  : "Paste raw chat threads or meeting notes; we automatically separate goals, tone, and guardrails."}
              </p>
              <textarea
                rows={5}
                className="ys-chaos-textarea"
                value={rawMemo}
                onChange={(e) => setRawMemo(e.currentTarget.value)}
                placeholder={
                  isKo
                    ? "예: 이번 신제품 런칭 릴스 3편 필요한데요, 피그마 Hero 프레임 색감 참고해주시고 초반 2초 훅이 세게 들어가면 좋겠어요. 나레이션은 아직 미정입니다..."
                    : "e.g. Need 3 launch reels matching the Figma Hero frame palette, strong 2s opening hook, voiceover still undecided..."
                }
                aria-label={isKo ? "비정형 기획 메모 입력" : "Unstructured brief memo"}
              />
            </div>
          </div>

          <div className="ys-intake-actions">
            <span className="bw-muted">
              {isKo
                ? "자료는 이 브랜드 공간 안에서만 암호화 보관되며, 의뢰만으로 결제나 계약이 발생하지 않습니다."
                : "Assets remain private to this workspace. Analyzing a brief creates no payment obligation."}
            </span>
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={runArgonAnalysis}
            >
              {analyzing
                ? isKo
                  ? "기획서·피그마를 읽고 빈칸을 찾는 중…"
                  : "Analyzing slides & finding gaps…"
                : isKo
                  ? "디렉터에게 읽히고 빈칸 질문 확인하기 →"
                  : "Analyze Brief & Check Missing Gaps →"}
            </button>
          </div>
        </div>
      )}

      {/* STAGE 02: Fable Gap-Filler Interview */}
      {activeStage === "interview" && (
        <div className="ys-cstage-body" data-brief-interview>
          <div className="ys-interview-banner">
            <div>
              <strong>
                {isKo
                  ? `기획서·메모에서 핵심 항목을 먼저 채웠어요. 빠져 있거나 확인이 필요한 ${GAP_QUESTIONS.length}가지만 골라주세요.`
                  : `We pre-filled your brief from the uploaded materials. Please confirm or defer these ${GAP_QUESTIONS.length} remaining items.`}
              </strong>
              <p className="bw-muted">
                {isKo
                  ? "아직 내부에서 안 정해진 항목은 고민하지 말고 [아직 미정 · YAGI 디렉터 추천에 맡길게요]를 누르세요. 디렉터가 가장 잘 맞는 기본값으로 설계해 드립니다."
                  : "If anything isn't decided internally yet, just click [Undecided · Let YAGI Director recommend]."}
              </p>
            </div>
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={() => setActiveStage("spec")}
            >
              {isKo ? "명세서 v1 전체 보기 →" : "View Full Spec Sheet v1 →"}
            </button>
          </div>

          <div className="ys-question-grid">
            {GAP_QUESTIONS.map((q, idx) => {
              const rec = answers[q.key]!;
              const whyOpen = whyOpenKey === q.key;
              return (
                <div
                  key={q.key}
                  className="ys-question-card"
                  data-question={q.key}
                  data-question-status={rec.status}
                >
                  <div className="ys-qcard-top">
                    <span className="ys-qcard-sec">
                      Q0{idx + 1} · {isKo ? q.sectionKo : q.sectionEn}
                    </span>
                    <span className={`ys-qstatus-badge ys-qstatus-${rec.status}`}>
                      {rec.status === "confirmed"
                        ? isKo
                          ? "✓ 직접 확정함"
                          : "✓ Confirmed"
                        : rec.status === "deferred"
                          ? isKo
                            ? "★ 디렉터 추천 위임"
                            : "★ Director Recommended"
                          : isKo
                            ? "기획서 자동 추출"
                            : "Auto-Extracted"}
                    </span>
                  </div>

                  <div className="ys-qcard-title-row">
                    <h4>{isKo ? q.questionKo : q.questionEn}</h4>
                    <button
                      type="button"
                      className="ys-why-toggle"
                      onClick={() => setWhyOpenKey(whyOpen ? null : q.key)}
                    >
                      {isKo ? "왜 묻나요 ▾" : "Why we ask ▾"}
                    </button>
                  </div>

                  {whyOpen && (
                    <p className="ys-why-box">{isKo ? q.whyKo : q.whyEn}</p>
                  )}

                  <p className="ys-evidence-line">
                    {isKo ? q.argonEvidenceKo : q.argonEvidenceEn}
                  </p>

                  <div className="ys-qoptions">
                    {q.options.map((opt) => {
                      const active =
                        rec.status !== "deferred" && rec.selectedId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={
                            active
                              ? "ys-qopt-btn ys-qopt-btn-active"
                              : "ys-qopt-btn"
                          }
                          aria-pressed={active}
                          onClick={() => selectOption(q.key, opt.id)}
                        >
                          {active ? "● " : "○ "}
                          {isKo ? opt.ko : opt.en}
                        </button>
                      );
                    })}

                    {/* Defer to YAGI Director button */}
                    <button
                      type="button"
                      className={
                        rec.status === "deferred"
                          ? "ys-qopt-btn ys-qopt-defer ys-qopt-defer-active"
                          : "ys-qopt-btn ys-qopt-defer"
                      }
                      aria-pressed={rec.status === "deferred"}
                      onClick={() => deferToDirector(q.key)}
                    >
                      ★ {isKo ? "아직 미정 · YAGI 디렉터 추천에 맡길게요" : "Undecided · Let YAGI Director recommend"}
                    </button>
                  </div>

                  <input
                    type="text"
                    className="ys-qcustom-input"
                    value={rec.customText}
                    onChange={(e) => setCustomAnswer(q.key, e.currentTarget.value)}
                    placeholder={
                      isKo
                        ? "또는 직접 한 줄로 적어주세요"
                        : "Or type your own answer in one line"
                    }
                    aria-label={`${isKo ? q.questionKo : q.questionEn} 직접 입력`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STAGE 03: Versioned 12-Section Production Spec Sheet */}
      {activeStage === "spec" && (
        <div className="ys-cstage-body" data-concierge-stage="spec">
          <div className="ys-spec-header-bar">
            <div>
              <span className="ys-spec-ver-pill">
                {isKo ? `제작 명세서 · v${specVersion}` : `Production Spec Sheet · v${specVersion}`}
              </span>
              <p className="bw-muted">
                {isKo
                  ? `분석 자료 ${droppedFiles.length + links.length}건 · 기획서 자동 추출 ${argonCount}개 · 브랜드 직접 확정 ${confirmedCount}개 · 디렉터 추천 위임 ${deferredCount}개`
                  : `Assets: ${droppedFiles.length + links.length} · Auto-Extracted: ${argonCount} · Brand Confirmed: ${confirmedCount} · Director Recommended: ${deferredCount}`}
              </p>
            </div>
            <div className="ys-spec-legend">
              <span className="ys-source-tag ys-source-argon">
                {isKo ? "기획서에서 읽음" : "Read from Deck"}
              </span>
              <span className="ys-source-tag ys-source-user">
                {isKo ? "직접 답함" : "Brand Confirmed"}
              </span>
              <span className="ys-source-tag ys-source-deferred">
                {isKo ? "★ 디렉터 추천 (미정 위임)" : "★ Director Recommended"}
              </span>
            </div>
          </div>

          <div className="ys-spec-table">
            <div className="ys-spec-row" data-spec-field="goal.primary">
              <div className="ys-spec-label">{isKo ? "01 · 캠페인 목표" : "01 · Primary Goal"}</div>
              <div className="ys-spec-val">{objective || projectTitle}</div>
              <span className="ys-source-tag ys-source-argon">
                {isKo ? "기획서 1p에서 읽음" : "Deck p.1"}
              </span>
            </div>
            <div className="ys-spec-row" data-spec-field="delivery.kind">
              <div className="ys-spec-label">{isKo ? "02 · 납품 포맷" : "02 · Deliverable Format"}</div>
              <div className="ys-spec-val">
                {deliverableKind === "film"
                  ? isKo
                    ? "브랜드·캠페인 필름 (9:16 릴스 마스터 + 16:9 와이드)"
                    : "Brand Campaign Film (9:16 + 16:9)"
                  : deliverableKind === "product"
                    ? isKo
                      ? "제품 히어로 영상 (9:16 + 1:1 피드)"
                      : "Product Hero Video (9:16 + 1:1)"
                    : deliverableKind === "template"
                      ? isKo
                        ? "반복 제작용 브랜드 전용 템플릿"
                        : "Repeatable Brand Template"
                      : isKo
                        ? "YAGI 디렉터 맞춤 포맷 제안"
                        : "Director Custom Format"}
              </div>
              <span className="ys-source-tag ys-source-user">
                {isKo ? "직접 선택함" : "Selected"}
              </span>
            </div>

            {GAP_QUESTIONS.map((q, idx) => {
              const rec = answers[q.key]!;
              return (
                <div key={q.key} className="ys-spec-row" data-spec-field={q.key}>
                  <div className="ys-spec-label">
                    {String(idx + 3).padStart(2, "0")} · {isKo ? q.sectionKo : q.sectionEn}
                  </div>
                  <div className="ys-spec-val">{resolveAnswerText(q)}</div>
                  <span
                    className={
                      rec.status === "deferred"
                        ? "ys-source-tag ys-source-deferred"
                        : rec.source === "user"
                          ? "ys-source-tag ys-source-user"
                          : "ys-source-tag ys-source-argon"
                    }
                  >
                    {rec.status === "deferred"
                      ? isKo
                        ? "★ 디렉터 추천"
                        : "★ Director Default"
                      : rec.source === "user"
                        ? isKo
                          ? "직접 답함"
                          : "Brand Answered"
                        : isKo
                          ? "기획서에서 읽음"
                          : "Read from Deck"}
                  </span>
                </div>
              );
            })}

            <div className="ys-spec-row" data-spec-field="budget.private">
              <div className="ys-spec-label">{isKo ? "09 · 예산 및 계약 조건" : "09 · Budget & Terms"}</div>
              <div className="ys-spec-val">
                {isKo
                  ? "비공개 보관 (PD와 브랜드 관리자만 열람 · 외부 공유 카드에서 자동 제외)"
                  : "Confidential (Visible only to PD & Brand Owner; excluded from share cards)"}
              </div>
              <span className="ys-source-tag ys-source-user">
                {isKo ? "보안 격리됨" : "Isolated"}
              </span>
            </div>
          </div>

          <div className="ys-spec-footer">
            <button
              type="button"
              className="bw-button"
              onClick={() => setActiveStage("interview")}
            >
              {isKo ? "← 항목 수정하기" : "← Edit Answers"}
            </button>
            <div className="ys-spec-footer-right">
              <button
                type="button"
                className="bw-button"
                onClick={() => setActiveStage("share")}
              >
                {isKo ? "외부 공유용 프리뷰 카드 만들기" : "Create Shareable Preview Card"}
              </button>
              <button
                type="button"
                className="bw-button bw-primary"
                onClick={submitSpecSheetToStudio}
              >
                {submittedNotice
                  ? isKo
                    ? `✓ 명세서 v${specVersion - 1}이 스튜디오에 전송·기록되었습니다`
                    : `✓ Spec Sheet v${specVersion - 1} saved & sent to YAGI Studio`
                  : isKo
                    ? `명세서 v${specVersion} 확정하고 YAGI 제작팀에 보내기 →`
                    : `Lock Spec v${specVersion} & Send to YAGI Team →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 04: B2B Viral Share Card ("이 브리프, 카드로 보내세요") */}
      {activeStage === "share" && (
        <div className="ys-cstage-body" data-share-card>
          <div className="ys-viral-banner">
            <div>
              <span className="ys-kicker-badge ys-badge-gold">
                {isKo ? "B2B PREVIEW DECK · 외부 공유 카드" : "B2B PREVIEW DECK · Shareable Card"}
              </span>
              <h4>{isKo ? "보여주고 싶은 사람이 있나요? 이 브리프, 카드로 보내세요." : "Need to align stakeholders or partners? Send this brief as a preview card."}</h4>
              <p className="bw-muted">
                {isKo
                  ? "예산·계약 조건·담당자 연락처·금지 표현 목록은 100% 가리고, AI 디렉터가 정리한 [미감 DNA + 3컷 콘티 + 시사실]만 깔끔한 프리뷰 카드로 담깁니다 (14일 후 자동 만료)."
                  : "Confidential budget, contract terms, and guardrails are 100% stripped. Only the Visual Mood DNA, 3-Cut Shot Strip, and Screening Room are shared (expires in 14 days)."}
              </p>
            </div>
            <div className="ys-viral-actions">
              <button
                type="button"
                className="bw-button"
                onClick={() => setSharePreviewOpen((prev) => !prev)}
              >
                {sharePreviewOpen
                  ? isKo
                    ? "미리보기 접기"
                    : "Hide Preview"
                  : isKo
                    ? "무엇이 보이는지 미리 보기"
                    : "Preview External Card"}
              </button>
              <button
                type="button"
                className="bw-button bw-primary"
                onClick={copyViralPreviewCardLink}
              >
                {shareLinkCopied
                  ? isKo
                    ? "✓ 프리뷰 카드 링크를 복사했어요"
                    : "✓ Preview Card Link Copied"
                  : isKo
                    ? "프리뷰 카드 링크 복사"
                    : "Copy Preview Card Link"}
              </button>
            </div>
          </div>

          <div className="ys-viral-card-preview">
            <div className="ys-viral-card-top">
              <span className="ys-viral-eyebrow">YAGI PRODUCTION · PREVIEW</span>
              <span className="ys-viral-blind-badge">
                {isKo ? "예산·계약·내부 조건 비노출" : "Budget & Terms Redacted"}
              </span>
            </div>
            <h3>
              {isKo
                ? `${brandName}의 다음 필름 — ${projectTitle}`
                : `${brandName}'s Next Film — ${projectTitle}`}
            </h3>
            <p className="bw-muted">
              {isKo
                ? `YAGI 디렉터가 기획 자료 ${droppedFiles.length + links.length}건을 읽고 정리한 미감 DNA와 3컷 콘티 명세입니다.`
                : `Visual Mood DNA and 3-cut storyboard compiled by YAGI Director from ${droppedFiles.length + links.length} source materials.`}
            </p>
            <div className="ys-viral-card-highlights">
              <div>
                <small>{isKo ? "편집 호흡" : "Cut Pacing"}</small>
                <strong>{resolveAnswerText(GAP_QUESTIONS[0]!)}</strong>
              </div>
              <div>
                <small>{isKo ? "사운드·보이스" : "Sound & VO"}</small>
                <strong>{resolveAnswerText(GAP_QUESTIONS[4]!)}</strong>
              </div>
              <div>
                <small>{isKo ? "목표 납기" : "Target Delivery"}</small>
                <strong>{resolveAnswerText(GAP_QUESTIONS[5]!)}</strong>
              </div>
            </div>
            <footer className="ys-viral-card-footer">
              <div>
                <strong>
                  {isKo
                    ? "Produced in YAGI STUDIO · 우리 브랜드도 이렇게 정리받기"
                    : "Produced in YAGI STUDIO · Turn your raw deck into a film spec"}
                </strong>
                <p>
                  {isKo
                    ? "기획서나 피그마만 던지면 디렉터가 읽고, 빠진 것만 묻습니다."
                    : "Drop your slides or Figma — our director reads it and asks only what's missing."}
                </p>
              </div>
              <span className="ys-viral-cta-pill">
                {isKo ? "YAGI STUDIO 알아보기 →" : "Explore YAGI STUDIO →"}
              </span>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
