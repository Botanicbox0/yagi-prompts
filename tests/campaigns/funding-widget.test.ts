import { describe, expect, it, vi } from "vitest";
import { fundingWidgetMethodSupported } from "@/lib/campaigns/funding/payment-method";
import {
  observeFundingAgreement,
  type FundingAgreementWidget,
} from "@/lib/campaigns/funding/widget-agreement";

describe("funding widget agreement initialization", () => {
  it.each(["CARD", "TOSSPAY"])("allows supported widget method %s", (code) =>
    expect(fundingWidgetMethodSupported(code)).toBe(true),
  );
  it.each([
    "VIRTUAL_ACCOUNT",
    "TRANSFER",
    "MOBILE_PHONE",
    "NAVERPAY",
    "",
    "UNKNOWN",
  ])("blocks unsupported widget method %s", (code) =>
    expect(fundingWidgetMethodSupported(code)).toBe(false),
  );
  it.each([true, false])(
    "reads initial required agreement=%s without a change event",
    async (agreedRequiredTerms) => {
      const update = vi.fn();
      await observeFundingAgreement(
        {
          on: vi.fn(),
          getAgreementStatus: async () => ({ agreedRequiredTerms }),
        },
        update,
      );
      expect(update).toHaveBeenCalledExactlyOnceWith(agreedRequiredTerms);
    },
  );

  it("preserves a newer checkbox change over a delayed initial snapshot", async () => {
    let emit!: (status: { agreedRequiredTerms: boolean }) => void;
    let resolve!: (status: { agreedRequiredTerms: boolean }) => void;
    const update = vi.fn();
    const pending = observeFundingAgreement(
      {
        on: (_, callback) => {
          emit = callback;
        },
        getAgreementStatus: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
      update,
    );
    emit({ agreedRequiredTerms: false });
    resolve({ agreedRequiredTerms: true });
    await pending;
    expect(update.mock.calls).toEqual([[false]]);
    emit({ agreedRequiredTerms: true });
    expect(update.mock.calls).toEqual([[false], [true]]);
  });

  it("does not assume consent when a runtime lacks the getter", async () => {
    let emit!: Parameters<FundingAgreementWidget["on"]>[1];
    const update = vi.fn();
    await observeFundingAgreement(
      {
        on: (_, callback) => {
          emit = callback;
        },
      },
      update,
    );
    expect(update).not.toHaveBeenCalled();
    emit({ agreedRequiredTerms: true });
    expect(update).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("fails closed when initial status cannot be read", async () => {
    const update = vi.fn();
    await expect(
      observeFundingAgreement(
        {
          on: vi.fn(),
          getAgreementStatus: async () => {
            throw Error("unavailable");
          },
        },
        update,
      ),
    ).rejects.toThrow("unavailable");
    expect(update).not.toHaveBeenCalled();
  });
});
