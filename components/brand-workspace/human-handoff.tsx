"use client";

import { useState } from "react";

export type HandoffChannel = "callback_now" | "callback_at" | "skip_to_pd";
export type HandoffStatus = "none" | "requested";

export function HumanHandoff({
  organizationId,
  projectId,
  specVersion = 1,
  refCount = 2,
  openQuestions = 3,
  contextSummary = "",
  locale,
}: {
  organizationId?: string;
  projectId?: string;
  specVersion?: number;
  refCount?: number;
  openQuestions?: number;
  contextSummary?: string;
  locale: string;
}) {
  const isKo = locale === "ko";
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<HandoffStatus>("none");
  const [channel, setChannel] = useState<HandoffChannel>("callback_now");
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [busy, setBusy] = useState(false);

  const triggerHandoff = async (chosenChannel: HandoffChannel) => {
    setChannel(chosenChannel);
    setBusy(true);
    const channelLabel =
      chosenChannel === "callback_now"
        ? isKo
          ? "지금 바로 전화 요청 (ASAP 콜백)"
          : "ASAP Callback Now"
        : chosenChannel === "callback_at"
          ? isKo
            ? `시간 지정 통화 요청 (${preferredTime || "일정 협의"})`
            : `Scheduled Call (${preferredTime || "TBD"})`
          : isKo
            ? "AI 질문 건너뛰고 전담 PD에게 통째로 위임"
            : "Skip AI questions & hand off directly to PD";

    const messageBody = [
      `[⚡ YAGI STUDIO · 전담 PD 직통 호출 (${channelLabel})]`,
      `첨부 상태: 제작 명세서 v${specVersion} · 레퍼런스 ${refCount}건 · 미확정 항목 ${openQuestions}건`,
      phone.trim() ? `연락처: ${phone.trim()}` : null,
      preferredTime.trim() ? `희망 통화 시간: ${preferredTime.trim()}` : null,
      quickNote.trim() ? `한 줄 메모: ${quickNote.trim()}` : null,
      contextSummary.trim() ? `자동 정리 요약:\n${contextSummary.trim()}` : null,
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
              body: messageBody,
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
              body: messageBody,
              requestId:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : String(Date.now()),
            },
          }),
        });
      }
    } catch {
      // Keep UI responsive even in preview/offline state
    } finally {
      setBusy(false);
      setStatus("requested");
    }
  };

  return (
    <div className="ys-handoff-wrapper ys-handoff-wrap" data-handoff data-handoff-state={status}>
      <div
        className="ys-handoff-bar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          className="ys-handoff-bar-copy"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            className="ys-handoff-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              background: "rgba(56, 117, 197, 0.12)",
              color: "#3063A7",
            }}
          >
            <span className="ys-brand-live-dot" aria-hidden="true" />
            {isKo ? "HUMAN PD · ASAP 직통 연결" : "HUMAN PD · ASAP Direct Escalation"}
          </span>
          <strong style={{ fontSize: 13.5, color: "#0E1013" }}>
            {status === "requested"
              ? isKo
                ? "전담 PD를 불렀어요 — 정리된 명세서와 레퍼런스를 함께 전달했습니다"
                : "Executive PD alerted — your spec sheet and references are attached"
              : isKo
                ? "AI에게 설명하기 애매한 뉘앙스나 예산·일정은 전담 PD와 바로 얘기하세요"
                : "Need to discuss budget, timeline, or subtle creative nuances? Talk to a human PD right now."}
          </strong>
        </div>
        <button
          type="button"
          className="bw-button ys-handoff-trigger"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {status === "requested"
            ? isKo
              ? "✓ PD 호출 완료 · 상세 보기"
              : "✓ PD Alerted · View status"
            : isKo
              ? "⚡ 사람과 바로 얘기하기"
              : "⚡ Talk to Human PD Now"}
        </button>
      </div>

      {open && (
        <div className="ys-handoff-sheet" role="region" aria-label={isKo ? "전담 PD 직통 연결" : "Direct PD Handoff"}>
          <header className="ys-handoff-sheet-header">
            <div>
              <h3>{isKo ? "사람이 더 빠른 일이 있죠" : "Sometimes a human producer is faster"}</h3>
              <p className="bw-muted">
                {isKo
                  ? `예산, 납기, 말로 풀기 어려운 연출 뉘앙스는 YAGI 전담 PD와 바로 정하세요. 지금까지 정리된 명세서 v${specVersion}과 레퍼런스 ${refCount}개, 미확정 질문 ${openQuestions}개는 그대로 들고 갑니다.`
                  : `Discuss budget, delivery dates, or nuanced direction directly with your YAGI PD. Spec v${specVersion}, ${refCount} references, and ${openQuestions} open items are automatically attached.`}
              </p>
            </div>
            <button
              type="button"
              className="ys-handoff-close"
              onClick={() => setOpen(false)}
            >
              {isKo ? "닫기" : "Close"}
            </button>
          </header>

          {status === "requested" ? (
            <div className="ys-handoff-confirmed" role="status">
              <strong>
                {isKo
                  ? `✓ YAGI 전담 PD에게 긴급 호출(${channel === "callback_now" ? "즉시 콜백" : channel === "callback_at" ? "예약 통화" : "명세서 통째 위임"})이 접수되었습니다.`
                  : "✓ Your priority request has been sent to the YAGI Executive Producer."}
              </strong>
              <p>
                {isKo
                  ? "처음부터 다시 설명하실 필요 없습니다. 업로드하신 기획서와 미감 DNA, 미정 항목을 PD가 먼저 읽고 연락드립니다."
                  : "No need to repeat yourself. Your PD is reviewing the attached brief and Mood DNA now."}
              </p>
              <button
                type="button"
                className="bw-button"
                onClick={() => setStatus("none")}
              >
                {isKo ? "요청 방식 바꾸기" : "Change handoff method"}
              </button>
            </div>
          ) : (
            <div className="ys-handoff-options">
              <div className="ys-handoff-card">
                <div>
                  <strong>{isKo ? "① 지금 바로 전화 주세요 (ASAP 콜백)" : "① Call me right now (ASAP Callback)"}</strong>
                  <p>{isKo ? "영업시간 기준 가장 빠르게 전담 PD가 전화를 드립니다." : "Our executive PD will call your number right away during studio hours."}</p>
                </div>
                <div className="ys-handoff-inline-inputs">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.currentTarget.value)}
                    placeholder={isKo ? "연락받을 번호 (예: 010-1234-5678)" : "Phone number"}
                    aria-label={isKo ? "연락받을 전화번호" : "Phone number"}
                  />
                  <button
                    type="button"
                    className="bw-button bw-primary"
                    disabled={busy}
                    onClick={() => triggerHandoff("callback_now")}
                  >
                    {isKo ? "지금 콜백 요청" : "Request Callback"}
                  </button>
                </div>
              </div>

              <div className="ys-handoff-card">
                <div>
                  <strong>{isKo ? "② 시간 정해서 15분 퀵 콜 / 구글 밋" : "② Schedule a 15-min Quick Call / Meet"}</strong>
                  <p>{isKo ? "편한 시간대를 적어주시면 PD 일정에 바로 잡아둡니다." : "Pick a convenient window and we will lock it into the PD schedule."}</p>
                </div>
                <div className="ys-handoff-inline-inputs">
                  <input
                    type="text"
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.currentTarget.value)}
                    placeholder={isKo ? "예: 오늘 오후 4시 이후 / 내일 오전 11시" : "e.g. Today after 4pm / Tomorrow 11am"}
                    aria-label={isKo ? "희망 통화 시간" : "Preferred call time"}
                  />
                  <button
                    type="button"
                    className="bw-button"
                    disabled={busy}
                    onClick={() => triggerHandoff("callback_at")}
                  >
                    {isKo ? "통화 예약" : "Schedule Call"}
                  </button>
                </div>
              </div>

              <div className="ys-handoff-card ys-handoff-skip-card">
                <div>
                  <strong>{isKo ? "③ 질문은 건너뛰고 PD에게 통째로 넘길게요" : "③ Skip remaining questions & hand off to PD"}</strong>
                  <p>{isKo ? "지금까지 올린 자료와 읽은 내용만으로 PD가 알아서 명세서 빈칸을 채워 제안합니다." : "Hand over everything uploaded so far; our PD will fill in the remaining gaps for you."}</p>
                  <input
                    type="text"
                    value={quickNote}
                    onChange={(e) => setQuickNote(e.currentTarget.value)}
                    placeholder={isKo ? "PD에게 남길 한 줄 메모 (선택)" : "Optional one-line note for the PD"}
                    aria-label={isKo ? "PD에게 남길 한 줄 메모" : "Note for PD"}
                  />
                </div>
                <button
                  type="button"
                  className="bw-button"
                  disabled={busy}
                  onClick={() => triggerHandoff("skip_to_pd")}
                >
                  {isKo ? "현재 상태 그대로 PD에게 넘기기 →" : "Hand Off As-Is →"}
                </button>
              </div>
            </div>
          )}

          <footer className="ys-handoff-footer">
            <span>
              {isKo
                ? `자동 첨부 패키지: 제작 명세서 v${specVersion} · 레퍼런스 ${refCount}개 · 미확정 항목 ${openQuestions}개`
                : `Auto-attached: Spec v${specVersion} · ${refCount} references · ${openQuestions} open items`}
            </span>
          </footer>
        </div>
      )}
    </div>
  );
}
