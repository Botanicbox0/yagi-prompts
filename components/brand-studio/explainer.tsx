/**
 * First-use explanation shared by the image, video and review screens (docs/BRAND-STUDIO-V3.md §3).
 * Stub until slice A lands. Props are the contract: a hero (title, one line, up to two actions, an
 * optional media slot) and three to six step cards; `storageKey` remembers "다시 보지 않기".
 */
import type { ReactNode } from "react";

export interface ExplainerStep {
  title: string;
  line: string;
  media?: ReactNode;
}
export interface ExplainerProps {
  storageKey: string;
  title: string;
  line: string;
  actions?: Array<{ label: string; href?: string; event?: string; primary?: boolean }>;
  media?: ReactNode;
  stepsTitle?: string;
  steps: ExplainerStep[];
  dismissLabel: string;
  reopenLabel: string;
}

export function Explainer(_props: ExplainerProps) {
  return null;
}
