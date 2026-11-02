import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, legalDocument } from "@/lib/legal/documents";
import { subscriptionLegalDocument } from "@/lib/creator-subscriptions/legal-projection";
import {
  SUBSCRIPTION_PREPARING_NOTICE,
  SUBSCRIPTION_TERMS_DRAFT,
} from "@/lib/creator-subscriptions/legal";
import { subscriptionTermsDigest } from "@/lib/creator-subscriptions/evidence";

describe("approved monthly legal projection", () => {
  it("replaces only template article 4 and preserves the complete brand campaign article in both languages", () => {
    for (const locale of ["ko", "en"] as const) {
      const source = legalDocument("terms", locale).body;
      const heading =
        locale === "ko"
          ? "## 제4조의2 (브랜드 캠페인 서비스 대금)"
          : "## 4A. Brand campaign service payments";
      const start = source.indexOf(heading);
      const end = source.indexOf("\n## ", start + heading.length);
      expect(start).toBeGreaterThan(0);
      const brandArticle = source.slice(start, end).trim();
      for (const approved of [false, true]) {
        const projected = subscriptionLegalDocument(
          "terms",
          locale,
          approved,
        ).body;
        expect(projected).toContain(brandArticle);
        expect(projected.split(heading)).toHaveLength(2);
        expect(projected).toContain(
          locale === "ko"
            ? "월 구독은 가입 화면의 플랜 금액"
            : "A monthly subscription uses the plan price",
        );
        expect(projected).not.toContain(
          locale === "ko"
            ? "## 제4조 (템플릿 결과물 결제)"
            : "## 4. Payment for template results",
        );
      }
    }
  });
  it("preserves campaign refund scope and all section 8 conditions when replacing the template description", () => {
    for (const locale of ["ko", "en"] as const) {
      const source = legalDocument("refund", locale).body;
      const campaign = source
        .slice(source.indexOf(locale === "ko" ? "## 8." : "## 8."))
        .trim();
      const scope = source.split("\n\n")[1];
      for (const approved of [false, true]) {
        const projected = subscriptionLegalDocument(
          "refund",
          locale,
          approved,
        ).body;
        expect(projected).toContain(scope);
        expect(projected).toContain(campaign.replace(/^## /gm, "### "));
        expect(projected).not.toMatch(/not a subscription|정기결제가 아닌/);
      }
    }
  });
  it("publishes preparing monthly terms and refunds without treating publication as launch approval", () => {
    for (const locale of ["ko", "en"] as const) {
      const terms = subscriptionLegalDocument("terms", locale, false);
      const refund = subscriptionLegalDocument("refund", locale, false);
      expect(terms.body).toContain(
        locale === "ko"
          ? "월 구독은 현재 준비 중"
          : "Monthly subscriptions are being prepared",
      );
      expect(refund.body).toContain(
        locale === "ko"
          ? "월 구독의 해지와 환불"
          : "Monthly subscription cancellation and refunds",
      );
      expect(refund.summary).toContain(
        locale === "ko" ? "월 구독" : "monthly subscriptions",
      );
      expect(subscriptionLegalDocument("privacy", locale, false)).toBe(
        legalDocument("privacy", locale),
      );
    }
  });
  it("preserves one-time purchase terms and keeps preparing and approved policies identical apart from the notice", () => {
    for (const locale of ["ko", "en"] as const)
      for (const doc of ["terms", "refund"] as const) {
        const approved = subscriptionLegalDocument(doc, locale, true).body;
        const preparing = subscriptionLegalDocument(doc, locale, false).body;
        expect(preparing).toBe(
          `${SUBSCRIPTION_PREPARING_NOTICE[locale]}\n\n${approved}`,
        );
        expect(approved).not.toContain(SUBSCRIPTION_PREPARING_NOTICE[locale]);
        for (const body of [approved, preparing])
          expect(body).toContain(
            locale === "ko"
              ? "충전식 재화, 포인트, 이용권"
              : "stored value, points or credits",
          );
        if (doc === "terms")
          expect(approved).toContain(
            locale === "ko"
              ? "완성 알림이 이메일로 발송됩니다"
              : "an email tells you when it is ready",
          );
      }
  });
  it("removes conflicting single-purchase payment text while preserving own-face verification", () => {
    for (const locale of ["ko", "en"] as const) {
      const terms = subscriptionLegalDocument("terms", locale, true).body;
      expect(terms).toContain(
        SUBSCRIPTION_TERMS_DRAFT[locale].replace(/^## /gm, "### "),
      );
      expect(terms).not.toMatch(
        /정기결제가 아닙니다|This is not a subscription/,
      );
      expect(terms).toContain(
        locale === "ko"
          ? "계정마다 하나뿐인 인물 자산 그룹"
          : "the one likeness asset group",
      );
    }
  });
  it("separates monthly refund rights from one-time purchase deadlines and explains OpenAI processing", () => {
    const refund = subscriptionLegalDocument("refund", "ko", true).body;
    expect(refund.indexOf("월 구독의 해지와 환불")).toBeLessThan(
      refund.indexOf("템플릿 단건 구매의 환불"),
    );
    expect(refund).toContain("현재 결제 기간의 제작량을 사용하지 않았고");
    expect(refund).toContain("관련 법령에 따른 권리");
    const privacy = subscriptionLegalDocument("privacy", "ko", true).body;
    expect(privacy).toContain("참고 이미지 최대 3장");
    expect(privacy).toContain(
      "원본 제작 프롬프트와 얼굴 기준 사진은 이 요청에 포함하지 않습니다",
    );
    expect(privacy).toContain("최대 30일");
    expect(privacy).not.toContain("즉시 삭제됩니다");
    expect(subscriptionTermsDigest()).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps automated unused refunds distinct from used-period and statutory refund rights", () => {
    const ko = subscriptionLegalDocument("refund", "ko", false).body;
    const en = subscriptionLegalDocument("refund", "en", false).body;
    expect(ko).toContain("환불 처리 중에는 영상 제작과 다음 자동결제가 중단");
    expect(ko).toContain("해당 작업에 사용한 제작량");
    expect(ko).toContain("아직 제공받지 않은 부분");
    expect(ko).toContain("청약철회 의사를 전달한 날부터 3영업일");
    expect(en).toContain("unused capacity for that job");
    expect(en).toContain("unprovided parts");
    expect(en).toContain("within 3 business days of receiving your withdrawal");
    for (const locale of ["ko", "en"] as const)
      for (const approved of [false, true]) {
        const body = subscriptionLegalDocument("refund", locale, approved).body;
        expect(body).not.toMatch(/^# /m);
        expect(body).not.toMatch(
          /The only paid item|TWINGS의 유료 상품은|not a subscription|정기결제가 아닌/,
        );
      }
  });
});
