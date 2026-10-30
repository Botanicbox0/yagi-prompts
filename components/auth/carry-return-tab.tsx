"use client";
import { useEffect } from "react";
import { withReturnTab } from "@/lib/auth/return-tab";

/** Keeps a campaign link's tab through sign-in (lib/auth/return-tab.ts). Without JS the links stay as rendered. */
export function CarryReturnTab() {
  useEffect(() => {
    const { hash } = location;
    if (!hash) return;
    for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-auth-provider], [data-auth-language] a")) {
      const href = link.getAttribute("href");
      if (href) link.setAttribute("href", withReturnTab(href, hash));
    }
  }, []);
  return null;
}
