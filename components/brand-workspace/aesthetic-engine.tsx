"use client";

import { useState } from "react";
import type { BrandReferenceLink } from "@/lib/brands/workspace/types";

type LookbookPreset = {
  id: string;
  titleKo: string;
  titleEn: string;
  subtitleKo: string;
  subtitleEn: string;
  videoUrl: string;
  palette: readonly [string, string, string, string, string];
  lightingKo: string;
  lightingEn: string;
  cameraKo: string;
  cameraEn: string;
  pacingKo: string;
  pacingEn: string;
  textureKo: string;
  textureEn: string;
  shots: readonly {
    cut: string;
    timecode: string;
    roleKo: string;
    roleEn: string;
    cameraBadge: string;
    descKo: string;
    descEn: string;
  }[];
};

const LOOKBOOK_PRESETS: readonly LookbookPreset[] = [
  {
    id: "atelier-editorial",
    titleKo: "파리 아틀리에 에디토리얼",
    titleEn: "Paris Atelier Editorial",
    subtitleKo: "따뜻한 필름 톤 · 자연광 림라이트 · 50mm 클로즈업",
    subtitleEn: "Warm film grade · tungsten rim · 50mm close-up",
    videoUrl: "/reel/brands/production-paris.mp4",
    palette: ["#0E0D0C", "#2B211B", "#8C583A", "#D9A773", "#F4ECE1"],
    lightingKo: "창가 확산 자연광 + 3200K 웜 림라이트 (콘트라스트 1:3)",
    lightingEn: "Diffused window key + 3200K warm rim light (1:3 contrast)",
    cameraKo: "50mm Prime · 얕은 심도(f/1.8) · 미세 핸드헬드 호흡",
    cameraEn: "50mm Prime · shallow DOF (f/1.8) · subtle handheld breathing",
    pacingKo: "초반 1.5초 시선 고정 후 3초 단위의 여유 있는 에디토리얼 호흡",
    pacingEn: "1.5s opening lock followed by measured 3.0s editorial beats",
    textureKo: "35mm 필름 그레인 15% · 소프트 하이라이트 할레이션",
    textureEn: "35mm film grain 15% · soft highlight halation",
    shots: [
      {
        cut: "CUT 01",
        timecode: "00:00 — 00:03",
        roleKo: "초반 3초 시선 고정 (Hook)",
        roleEn: "Opening 3s Hook",
        cameraBadge: "Extreme Close-Up · 50mm",
        descKo: "인물의 눈빛과 제품 실루엣이 웜 림라이트를 받으며 프레임 중앙으로 천천히 포커스 인됩니다.",
        descEn: "Subject gaze and product silhouette catch warm rim light as focus pulls into center frame.",
      },
      {
        cut: "CUT 02",
        timecode: "00:03 — 00:09",
        roleKo: "무드·디테일 전개 (Body)",
        roleEn: "Mood & Texture Body",
        cameraBadge: "Medium Tracking · Slow Push",
        descKo: "제품을 사용하는 손끝 질감과 공간의 빛 번짐을 60fps 슬로우 템포로 교차 편집해 몰입감을 높입니다.",
        descEn: "60fps slow-motion intercut of tactile hand interaction and ambient light bloom.",
      },
      {
        cut: "CUT 03",
        timecode: "00:09 — 00:15",
        roleKo: "브랜드 여운·엔딩 (Payoff)",
        roleEn: "Brand Lockup Payoff",
        cameraBadge: "Locked Hero Frame · 35mm",
        descKo: "정면 아이컨택과 함께 브랜드 키 컬러 톤이 정돈되며 깔끔한 여백 위에 핵심 메시지가 남습니다.",
        descEn: "Direct eye contact settles into a composed hero frame with clean negative space for brand copy.",
      },
    ],
  },
  {
    id: "city-neon-pace",
    titleKo: "도심 나이트 하이콘트라스트",
    titleEn: "Urban Night High-Contrast",
    subtitleKo: "쿨 차콜 & 레드 포인트 · 빠른 비트 컷 · 와이드 무빙",
    subtitleEn: "Cool charcoal & red accent · fast beat cuts · dynamic wide",
    videoUrl: "/reel/brands/city-fashion.mp4",
    palette: ["#07080C", "#181C26", "#3E4A63", "#ED1E1E", "#ECEFF4"],
    lightingKo: "웻 아스팔트 반사광 + 레드·아이스블루 탑 라이트 (하이콘트라스트)",
    lightingEn: "Wet asphalt specular bounce + red/ice-blue top light (high contrast)",
    cameraKo: "24mm 광각 로우앵글 · 빠른 휩팬(Whip Pan) & 줌 스냅",
    cameraEn: "24mm wide low-angle · fast whip-pan & zoom snap",
    pacingKo: "0.7초 단위 빠른 매치컷 진입 → 2초 슬로우 모션 드롭",
    pacingEn: "0.7s rapid match-cut entry → 2.0s speed-ramp drop",
    textureKo: "크리스프 디지털 샤프니스 + 아나모픽 수평 플레어",
    textureEn: "Crisp digital micro-contrast + anamorphic horizontal flare",
    shots: [
      {
        cut: "CUT 01",
        timecode: "00:00 — 00:02",
        roleKo: "초반 2초 텐션 훅 (Hook)",
        roleEn: "Opening 2s Tension Hook",
        cameraBadge: "Low-Angle 24mm · Speed Ramp",
        descKo: "도심 야경 속에서 인물이 카메라를 향해 걸어 나오며 0.7초 만에 시선을 강하게 붙잡습니다.",
        descEn: "Subject steps toward camera in a low-angle street frame with an immediate speed-ramp lock.",
      },
      {
        cut: "CUT 02",
        timecode: "00:02 — 00:08",
        roleKo: "리듬 매치컷 전개 (Body)",
        roleEn: "Rhythmic Match-Cut Body",
        cameraBadge: "Whip Pan · 35mm Tracking",
        descKo: "착장과 제품 포인트를 비트에 맞춘 3연속 매치컷으로 연결해 지루할 틈 없이 에너지를 끌어올립니다.",
        descEn: "Three beat-synced match cuts linking styling details and hero product angles.",
      },
      {
        cut: "CUT 03",
        timecode: "00:08 — 00:15",
        roleKo: "시그니처 포즈 엔딩 (Payoff)",
        roleEn: "Signature Freeze Payoff",
        cameraBadge: "Center Hero · Red Rim",
        descKo: "강렬한 레드 림라이트 아래 시그니처 포즈로 정지하며 브랜드 슬로건이 선명하게 각인됩니다.",
        descEn: "Hard stop under signature red rim light with crisp center composition.",
      },
    ],
  },
  {
    id: "botanical-daylight",
    titleKo: "보태니컬 소프트 데이라이트",
    titleEn: "Botanical Soft Daylight",
    subtitleKo: "맑은 정오 채광 · 클린 아이보리 · 매크로 디테일",
    subtitleEn: "Clean noon daylight · warm ivory · macro product texture",
    videoUrl: "/reel/brands/tea-editorial.mp4",
    palette: ["#161A16", "#3A473B", "#7FA07E", "#D8E2D1", "#F8F7F2"],
    lightingKo: "5600K 데이라이트 소프트박스 + 화이트 바운스 (그림자 최소화)",
    lightingEn: "5600K daylight softbox + white bounce fill (minimal shadow)",
    cameraKo: "85mm 매크로 렌즈 · 트라이포드 정밀 패닝 · 수직 탑다운 교차",
    cameraEn: "85mm Macro lens · fluid tripod pan · overhead top-down intercut",
    pacingKo: "정갈하고 차분한 2.5초 호흡 · ASMR 질감 중심 편집",
    pacingEn: "Calm 2.5s cadence · tactile ASMR-driven transitions",
    textureKo: "투명한 수분감과 자연광 하이라이트 · 무보정 클린 톤",
    textureEn: "Clean specular moisture highlights · zero-grain natural finish",
    shots: [
      {
        cut: "CUT 01",
        timecode: "00:00 — 00:03",
        roleKo: "청량한 질감 클로즈업 (Hook)",
        roleEn: "Tactile Macro Hook",
        cameraBadge: "85mm Macro · 60fps",
        descKo: "제품 제형과 자연광 물방울이 선명하게 잡히는 초근접 샷으로 첫 화면부터 신뢰감을 줍니다.",
        descEn: "Ultra-clean macro shot of formulation texture and natural daylight droplets.",
      },
      {
        cut: "CUT 02",
        timecode: "00:03 — 00:10",
        roleKo: "일상 루틴 사용 장면 (Body)",
        roleEn: "Natural Routine Body",
        cameraBadge: "Eye-Level 50mm · Soft Daylight",
        descKo: "인물이 자연광 아래서 제품을 사용하는 모습을 과장 없이 편안하고 맑은 피부 톤으로 담아냅니다.",
        descEn: "Unforced, sunlit application sequence emphasizing natural skin tone and ease of use.",
      },
      {
        cut: "CUT 03",
        timecode: "00:10 — 00:15",
        roleKo: "클린 패키지 스틸컷 (Payoff)",
        roleEn: "Clean Still-Life Payoff",
        cameraBadge: "Top-Down Table · 50mm",
        descKo: "정돈된 오브제와 함께 제품 패키지가 정중앙에 놓이며 구매 전환을 유도하는 컷으로 마무리됩니다.",
        descEn: "Composed tabletop still-life with product hero centered in crisp daylight.",
      },
    ],
  },
  {
    id: "rose-glow-beauty",
    titleKo: "로즈 글로우 뷰티 클로즈업",
    titleEn: "Rose Glow Beauty Close-Up",
    subtitleKo: "스킨 스페큘러 광채 · 샴페인 골드 · 시네마틱 슬로우",
    subtitleEn: "Specular skin glow · champagne gold · cinematic slow-mo",
    videoUrl: "/reel/campaigns/beauty-rose.mp4",
    palette: ["#140D10", "#42212B", "#9E5869", "#E5B2B8", "#FFF5F6"],
    lightingKo: "뷰티 디쉬 정면 키라이트 + 샴페인 골드 백라이트 (피부 윤광 강조)",
    lightingEn: "Front beauty-dish key + champagne gold backlight (skin specular glow)",
    cameraKo: "85mm 인물 포트레이트 렌즈 · 정밀 돌리 인(Dolly-In)",
    cameraEn: "85mm Portrait lens · smooth motorized dolly-in",
    pacingKo: "첫 2초 아이컨택 → 부드러운 디졸브와 슬로우 모션 중심",
    pacingEn: "2.0s eye-contact lock → seamless slow-motion dissolves",
    textureKo: "실키 스킨 디퓨전(Black Pro-Mist 1/8) · 벨벳 하이라이트",
    textureEn: "Silky skin diffusion (Black Pro-Mist 1/8) · velvet specular roll-off",
    shots: [
      {
        cut: "CUT 01",
        timecode: "00:00 — 00:03",
        roleKo: "광채 아이컨택 (Hook)",
        roleEn: "Specular Eye-Contact Hook",
        cameraBadge: "85mm Beauty Close-Up",
        descKo: "조명을 받아 빛나는 피부 결과 또렷한 시선이 정면으로 마주치며 스크롤을 즉시 멈추게 합니다.",
        descEn: "Luminous skin highlight and direct camera gaze create an instant scroll-stopping opening.",
      },
      {
        cut: "CUT 02",
        timecode: "00:03 — 00:09",
        roleKo: "텍스처 & 발색 클로즈업 (Body)",
        roleEn: "Texture & Swatch Body",
        cameraBadge: "Macro Dolly-In · 90fps",
        descKo: "입술·볼 위에 얹어지는 발색과 은은한 골드 윤광을 초고속 카메라 호흡으로 우아하게 보여줍니다.",
        descEn: "High-frame-rate close-up of color payoff and champagne highlight across the cheekbone.",
      },
      {
        cut: "CUT 03",
        timecode: "00:09 — 00:15",
        roleKo: "히어로 제품 투샷 (Payoff)",
        roleEn: "Hero Product Two-Shot",
        cameraBadge: "Medium Close-Up · 85mm",
        descKo: "인물 턱선 옆으로 제품 본품이 포커스되며 브랜드 무드와 제품명을 동시에 기억시킵니다.",
        descEn: "Product bottle held beside the jawline with crisp dual focus and soft bokeh backdrop.",
      },
    ],
  },
] as const;

const FOCUS_AXES = [
  { id: "hook", ko: "초반 2초 시선 끄는 구도", en: "Opening 2s scroll-stopping hook" },
  { id: "color", ko: "색감과 조명 분위기", en: "Color palette & lighting mood" },
  { id: "motion", ko: "카메라 무빙·컷 템포", en: "Camera movement & cut pacing" },
  { id: "closeup", ko: "인물·제품 클로즈업 비율", en: "Subject & product close-up ratio" },
] as const;

export function AestheticEngine({
  locale,
  referenceLinks,
}: {
  locale: string;
  referenceLinks: readonly BrandReferenceLink[];
}) {
  const isKo = locale === "ko";
  const [selectedId, setSelectedId] = useState<string>(LOOKBOOK_PRESETS[0]!.id);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [selectedAxes, setSelectedAxes] = useState<string[]>(["hook", "color"]);
  const [preserveNote, setPreserveNote] = useState<string>("");
  const [cutFeedback, setCutFeedback] = useState<Record<string, "keep" | "adjust">>({});
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  const preset = LOOKBOOK_PRESETS.find((x) => x.id === selectedId) ?? LOOKBOOK_PRESETS[0]!;

  const toggleAxis = (id: string) => {
    setSelectedAxes((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev) : [...prev, id],
    );
  };

  const toggleCut = (cut: string, state: "keep" | "adjust") => {
    setCutFeedback((prev) => ({
      ...prev,
      [cut]: prev[cut] === state ? "keep" : state,
    }));
  };

  const injectIntoCommentBox = () => {
    const chosenAxes = FOCUS_AXES.filter((a) => selectedAxes.includes(a.id))
      .map((a) => (isKo ? a.ko : a.en))
      .join(", ");
    const cutsLine = preset.shots
      .map((s) => {
        const fb = cutFeedback[s.cut] ?? "keep";
        return `${s.cut} (${s.timecode}): ${fb === "adjust" ? (isKo ? "조정 희망" : "Adjust") : isKo ? "이 느낌 그대로" : "Keep"}`;
      })
      .join(" / ");
    const summary = isKo
      ? `[미감 브리프 확정] 기준 무드: ${preset.titleKo} | 살릴 포인트: ${chosenAxes} | 컷별 의견: ${cutsLine}${preserveNote.trim() ? ` | 한 줄 메모: ${preserveNote.trim()}` : ""}`
      : `[Mood Brief] Reference: ${preset.titleEn} | Focus: ${chosenAxes} | Cuts: ${cutsLine}${preserveNote.trim() ? ` | Note: ${preserveNote.trim()}` : ""}`;

    if (typeof document !== "undefined") {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '#conversation textarea[name="body"]',
      );
      if (textarea) {
        textarea.value = textarea.value
          ? `${textarea.value.trim()}\n${summary}`
          : summary;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(summary).catch(() => {});
      }
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2600);
    }
  };

  return (
    <div className="ys-aesthetic-engine" data-aesthetic-engine>
      <header className="ys-aesthetic-header">
        <div>
          <span className="ys-kicker-badge">
            <span className="ys-brand-live-dot" aria-hidden="true" />
            {isKo ? "YAGI 미감 구현 엔진 · VLM Shot Director" : "YAGI Aesthetic Engine · VLM Shot Director"}
          </span>
          <h3>
            {isKo
              ? "원하는 영상 분위기를 고르면, 촬영·조명·3컷 콘티로 자동 번역됩니다"
              : "Pick the visual mood you want — we translate it into lighting, lens, and a 3-cut shot strip"}
          </h3>
          <p className="bw-muted">
            {isKo
              ? "어려운 영상 용어로 기획서를 쓰지 않아도 됩니다. 마음에 드는 레퍼런스와 살리고 싶은 포인트만 짚어주시면 YAGI 전담 디렉터와 생성 엔진이 바로 시안(v1) 제작에 반영합니다."
              : "No technical film jargon needed. Pick a reference look and what you like about it; YAGI translates your taste directly into production parameters for Cut v1."}
          </p>
        </div>
      </header>

      {/* STEP 1: Visual Taste Picker */}
      <div className="ys-engine-step" data-engine-step="1">
        <div className="ys-step-title">
          <span className="ys-step-num">STEP 01</span>
          <strong>
            {isKo
              ? "어떤 분위기의 영상을 원하시나요? (YAGI 룩북 또는 외부 레퍼런스)"
              : "Choose your reference lookbook & key focus points"}
          </strong>
        </div>
        <div className="ys-lookbook-grid" role="group" aria-label={isKo ? "레퍼런스 룩북 선택" : "Reference lookbook selection"}>
          {LOOKBOOK_PRESETS.map((item) => {
            const active = item.id === preset.id;
            const playing = activePreviewId === item.id;
            return (
              <div
                key={item.id}
                className="ys-lookbook-card"
                data-selected={active ? "true" : undefined}
              >
                <div className="ys-lookbook-media">
                  {playing ? (
                    <video
                      src={item.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                    />
                  ) : (
                    <div
                      className="ys-lookbook-swatch-preview"
                      style={{
                        background: `linear-gradient(135deg, ${item.palette[0]} 0%, ${item.palette[1]} 35%, ${item.palette[2]} 70%, ${item.palette[3]} 100%)`,
                      }}
                    >
                      <button
                        type="button"
                        className="ys-lookbook-play-btn"
                        onClick={() => {
                          setSelectedId(item.id);
                          setActivePreviewId(item.id);
                        }}
                      >
                        ▶ {isKo ? "무드 영상 미리보기" : "Preview reel"}
                      </button>
                    </div>
                  )}
                  <div className="ys-mini-palette" aria-hidden="true">
                    {item.palette.map((hex) => (
                      <span key={hex} style={{ backgroundColor: hex }} title={hex} />
                    ))}
                  </div>
                </div>
                <div className="ys-lookbook-body">
                  <strong>{isKo ? item.titleKo : item.titleEn}</strong>
                  <p>{isKo ? item.subtitleKo : item.subtitleEn}</p>
                  <button
                    type="button"
                    className={active ? "bw-button bw-primary ys-lookbook-pick" : "bw-button ys-lookbook-pick"}
                    aria-pressed={active}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {active
                      ? isKo
                        ? "✓ 현재 기준 무드로 선택됨"
                        : "✓ Selected as target mood"
                      : isKo
                        ? "이 무드 기준으로 보기"
                        : "Select this mood"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {referenceLinks.length > 0 && (
          <div className="ys-attached-refs">
            <small>
              {isKo
                ? `브랜드가 첨부한 외부 레퍼런스 (${referenceLinks.length}건) — VLM 9프레임 분석 연동됨`
                : `Attached brand references (${referenceLinks.length}) — linked to VLM 9-frame analysis`}
            </small>
          </div>
        )}

        <div className="ys-focus-row">
          <span className="ys-focus-label">
            {isKo ? "이 레퍼런스에서 꼭 살리고 싶은 포인트:" : "What to preserve from this reference:"}
          </span>
          <div className="ys-focus-chips">
            {FOCUS_AXES.map((axis) => {
              const on = selectedAxes.includes(axis.id);
              return (
                <button
                  key={axis.id}
                  type="button"
                  className="ys-focus-chip"
                  aria-pressed={on}
                  onClick={() => toggleAxis(axis.id)}
                >
                  {on ? "✓ " : "+ "}
                  {isKo ? axis.ko : axis.en}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* STEP 2: VLM 5-Point Mood DNA Card */}
      <div className="ys-engine-step" data-engine-step="2">
        <div className="ys-step-title">
          <span className="ys-step-num">STEP 02</span>
          <strong>
            {isKo
              ? "AI 디렉터가 추출한 5대 미감 DNA (촬영·조명·색감 설계도)"
              : "Auto-extracted 5-Point Visual DNA (Color · Lighting · Lens · Pacing)"}
          </strong>
        </div>
        <div className="ys-dna-card" data-mood-dna={preset.id}>
          <div className="ys-dna-palette-col">
            <span className="ys-dna-label">
              {isKo ? "① 5색 컬러 팔레트 (CIE Lab)" : "① 5-Color Lab Palette"}
            </span>
            <div className="ys-dna-swatches">
              {preset.palette.map((hex) => (
                <div key={hex} className="ys-dna-swatch">
                  <span className="ys-dna-swatch-circle" style={{ backgroundColor: hex }} />
                  <code>{hex}</code>
                </div>
              ))}
            </div>
          </div>
          <dl className="ys-dna-specs">
            <div>
              <dt>{isKo ? "② 조명 설계 (Lighting)" : "② Lighting Setup"}</dt>
              <dd>{isKo ? preset.lightingKo : preset.lightingEn}</dd>
            </div>
            <div>
              <dt>{isKo ? "③ 카메라·렌즈 (Camera & Lens)" : "③ Camera & Lens"}</dt>
              <dd>{isKo ? preset.cameraKo : preset.cameraEn}</dd>
            </div>
            <div>
              <dt>{isKo ? "④ 편집 호흡 (Cut Rhythm)" : "④ Editing Rhythm"}</dt>
              <dd>{isKo ? preset.pacingKo : preset.pacingEn}</dd>
            </div>
            <div>
              <dt>{isKo ? "⑤ 질감·그레인 (Texture)" : "⑤ Texture & Grain"}</dt>
              <dd>{isKo ? preset.textureKo : preset.textureEn}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* STEP 3: 3-Cut Visual Shot Strip */}
      <div className="ys-engine-step" data-engine-step="3">
        <div className="ys-step-title">
          <span className="ys-step-num">STEP 03</span>
          <strong>
            {isKo
              ? "15초 3컷 비주얼 콘티 스트립 — 컷별로 느낌만 컨펌해 주세요"
              : "15s 3-Cut Visual Shot Strip — confirm or tweak each beat"}
          </strong>
        </div>
        <div className="ys-shot-strip">
          {preset.shots.map((shot) => {
            const state = cutFeedback[shot.cut] ?? "keep";
            return (
              <div key={shot.cut} className="ys-shot-card" data-shot-state={state}>
                <div className="ys-shot-card-top">
                  <span className="ys-shot-cut-badge">{shot.cut}</span>
                  <code className="ys-shot-timecode">{shot.timecode}</code>
                </div>
                <h4>{isKo ? shot.roleKo : shot.roleEn}</h4>
                <span className="ys-shot-camera">{shot.cameraBadge}</span>
                <p>{isKo ? shot.descKo : shot.descEn}</p>
                <div className="ys-shot-actions">
                  <button
                    type="button"
                    className={state === "keep" ? "ys-shot-btn ys-shot-btn-active" : "ys-shot-btn"}
                    onClick={() => toggleCut(shot.cut, "keep")}
                  >
                    {isKo ? "✓ 이 느낌 좋아요" : "✓ Keep this feel"}
                  </button>
                  <button
                    type="button"
                    className={state === "adjust" ? "ys-shot-btn ys-shot-btn-warn" : "ys-shot-btn"}
                    onClick={() => toggleCut(shot.cut, "adjust")}
                  >
                    {isKo ? "조금 조정할래요" : "Request tweak"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="ys-engine-footer">
          <input
            type="text"
            className="ys-preserve-input"
            value={preserveNote}
            onChange={(e) => setPreserveNote(e.currentTarget.value)}
            placeholder={
              isKo
                ? "한 줄 요청사항 (예: 제품 로고가 2번째 컷에서 더 선명하게 보이면 좋겠어요)"
                : "One-line note (e.g. Make the product label clearer in Cut 02)"
            }
            aria-label={isKo ? "미감 한 줄 메모" : "One-line aesthetic note"}
          />
          <button
            type="button"
            className="bw-button bw-primary"
            onClick={injectIntoCommentBox}
          >
            {copiedSummary
              ? isKo
                ? "✓ 미감 브리프가 복사·대화창에 입력되었습니다"
                : "✓ Copied & added to studio thread"
              : isKo
                ? "이 미감 설계도로 시안 요청 메모 남기기 →"
                : "Send this Mood & Shot Brief to YAGI Studio →"}
          </button>
        </div>
      </div>
    </div>
  );
}
