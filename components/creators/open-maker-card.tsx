'use client';

import { useState } from 'react';

export interface OpenMakerCardProps {
  locale: 'ko' | 'en';
  workspaceHref?: string;
}

export function OpenMakerCard({
  locale,
  workspaceHref = '/creators/workspace',
}: OpenMakerCardProps) {
  const [rightsAgreed, setRightsAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEn = locale === 'en';

  const activate = async () => {
    if (!rightsAgreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/makers/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rightsAgreed: true }),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (!response.ok || !json.ok) {
        setError(
          isEn
            ? 'Could not activate Maker Studio right now. Please try again.'
            : '지금은 메이커 스튜디오를 열 수 없어요. 잠시 후 다시 시도해 주세요.',
        );
        return;
      }
      window.location.assign(`${workspaceHref}?ok=applied`);
    } catch {
      setError(
        isEn
          ? 'Network error while activating Maker Studio.'
          : '네트워크 오류로 메이커 등록을 완료하지 못했어요.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-open-maker-activate
      className="space-y-5 rounded-[20px] border border-[#E4E4E7] bg-[#FFFFFF] p-6"
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wider text-[#CC1573]">
          {isEn ? 'Open Maker Studio' : '누구나 메이커 시작하기'}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-[#09090B]">
          {isEn
            ? 'Publish your own image or video templates in 1 click'
            : '심사 대기 없이 바로 나만의 템플릿을 만들 수 있어요'}
        </h2>
        <p className="text-sm leading-relaxed text-[#52525B]" style={{ wordBreak: 'keep-all' }}>
          {isEn
            ? 'Image templates can be authored anywhere; video templates with multi-reference audio or timelines open in desktop web. Payouts accrue once another user makes with your format.'
            : '이미지 템플릿은 어디서나, 레퍼런스 오디오·영상을 쓰는 영상 템플릿은 데스크톱 웹에서 제작해 공개할 수 있어요. 다른 유저가 사용할 때마다 예상 수익이 적립됩니다.'}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E4E4E7] bg-[#F4F4F5] p-4 text-sm leading-relaxed text-[#09090B]">
        <input
          type="checkbox"
          data-open-maker-pledge
          checked={rightsAgreed}
          onChange={(e) => setRightsAgreed(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#09090B]"
        />
        <span style={{ wordBreak: 'keep-all' }}>
          {isEn
            ? 'I confirm I created or hold rights to every prompt and reference asset I upload, and consent to immediate removal upon infringement reports.'
            : '본인이 제작하거나 정당한 권리를 보유한 프롬프트·레퍼런스만 등록하며, 타인 초상권·저작권 침해 시 즉시 비공개 조치됨에 동의합니다.'}
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-sm font-medium text-[#CC1573]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-open-maker-submit
          disabled={!rightsAgreed || busy}
          onClick={() => void activate()}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-[#FF58AE] px-6 py-3 text-sm font-bold text-[#09090B] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy
            ? (isEn ? 'Opening Maker Studio...' : '메이커 스튜디오 여는 중...')
            : (isEn ? 'Start as a Maker' : '동의하고 메이커 시작하기')}
        </button>
      </div>
    </section>
  );
}
