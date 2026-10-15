import { it, expect } from "vitest";
import {
  captureInvitationTransfer,
  forgetInvitationTransfer,
  invitationTransferKey,
  INVITATION_TRANSFER_TTL_MS,
  campaignInvitationBrowserAddress,
} from "@/lib/campaigns/collaboration/invitation-transfer";
const token = "a".repeat(43),
  clock = 100000;
const fixture = () => {
  const data = new Map<string, string>();
  return {
    data,
    storage: () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    }),
  };
};
it("restores the invitation after same-browser OAuth without a token in the return URL", () => {
  const f = fixture();
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: `#token=${token}`,
      storage: f.storage,
      now: clock,
    }),
  ).toEqual({ token, persisted: true });
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: "",
      storage: f.storage,
      now: clock + 1000,
    }),
  ).toEqual({ token, persisted: true });
  expect(
    captureInvitationTransfer({
      slug: "other",
      hash: "",
      storage: f.storage,
      now: clock + 1000,
    }).token,
  ).toBe("");
  forgetInvitationTransfer("campaign", f.storage);
  expect(f.data.size).toBe(0);
});
it("expires the transfer after 24 hours even though the server invitation can live up to seven days", () => {
  const f = fixture();
  captureInvitationTransfer({
    slug: "campaign",
    hash: `#token=${token}`,
    storage: f.storage,
    now: clock,
  });
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: "",
      storage: f.storage,
      now: clock + INVITATION_TRANSFER_TTL_MS,
    }).token,
  ).toBe("");
  expect(f.data.size).toBe(0);
});
it("discards malformed, legacy raw tokens and forged excessive retention", () => {
  const f = fixture(),
    key = invitationTransferKey("campaign");
  for (const value of [
    token,
    "{bad",
    JSON.stringify({
      token,
      expiresAt: clock + 2 * INVITATION_TRANSFER_TTL_MS,
    }),
    JSON.stringify(null),
  ]) {
    f.data.set(key, value);
    expect(
      captureInvitationTransfer({
        slug: "campaign",
        hash: "",
        storage: f.storage,
        now: clock,
      }).token,
    ).toBe("");
    expect(f.data.has(key)).toBe(false);
  }
});
it("keeps a fresh token in component memory when browser storage is blocked and never throws on cleanup", () => {
  const storage = () => {
    throw Error("SecurityError");
  };
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: `#token=${token}`,
      storage,
      now: clock,
    }),
  ).toEqual({ token, persisted: false });
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: "",
      storage,
      now: clock,
    }),
  ).toEqual({ token: "", persisted: false });
  expect(() => forgetInvitationTransfer("campaign", storage)).not.toThrow();
});
it("restores a copied Instagram external-browser destination only as the exact campaign fragment", () => {
  const f = fixture();
  captureInvitationTransfer({
    slug: "campaign",
    hash: `#token=${token}`,
    storage: f.storage,
    now: clock,
  });
  const target = "https://twings.app/campaigns/campaign/join",
    copy = campaignInvitationBrowserAddress(
      target,
      "https://twings.app",
      f.storage,
      clock + 1000,
    );
  expect(new URL(copy).hash).toBe(`#token=${token}`);
  expect(new URL(copy).search).toBe("");
  // A fresh browser receives the fragment, captures its own session copy, then can perform OAuth.
  const external = fixture();
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: new URL(copy).hash,
      storage: external.storage,
      now: clock + 1000,
    }).token,
  ).toBe(token);
  expect(
    captureInvitationTransfer({
      slug: "campaign",
      hash: "",
      storage: external.storage,
      now: clock + 2000,
    }).token,
  ).toBe(token);
  for (const unsafe of [
    "https://evil.example/campaigns/campaign/join",
    "https://twings.app/auth/choose?next=%2Fcampaigns%2Fcampaign%2Fjoin",
    "https://twings.app/campaigns/other/join",
    "https://twings.app/campaigns/campaign/join?next=elsewhere",
    "https://twings.app/campaigns/%2Fcampaign/join",
  ])
    expect(
      campaignInvitationBrowserAddress(
        unsafe,
        "https://twings.app",
        f.storage,
        clock,
      ),
    ).toBe(unsafe);
  expect(
    campaignInvitationBrowserAddress(
      target,
      "https://twings.app",
      f.storage,
      clock + INVITATION_TRANSFER_TTL_MS,
    ),
  ).toBe(target);
});
