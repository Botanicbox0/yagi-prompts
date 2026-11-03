import type { ReactNode } from "react";

/**
 * The admin menu's glyphs (docs/ADMIN.md §5): 16px, one stroke weight, `currentColor`, so the rail
 * stays grey until an entry is current. Drawn here rather than imported: the admin ships no icon
 * library and needs fifteen shapes.
 */
const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  renders: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M7 6.1v3.8l3.2-1.9z" />
    </>
  ),
  prompts: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
    </>
  ),
  community: <path d="M7.5 2.5l1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1-3.1-1.2 3.1-1.2zM12.5 10.5v3M11 12h3" />,
  contests: <path d="M5 2.5h6v3a3 3 0 0 1-6 0zM8 8.5v3M5.5 13.5h5M5 3.8H3.2A2.2 2.2 0 0 0 5.4 6.5M11 3.8h1.8a2.2 2.2 0 0 1-2.2 2.7" />,
  brandWorkspace: (
    <>
      <rect x="2.5" y="5" width="11" height="8.5" rx="1.6" />
      <path d="M6 5V3.5h4V5M2.5 8.8h11" />
    </>
  ),
  campaigns: <path d="M2.8 6.6v2.8h2l5 3V3.6l-5 3zM12 6.1a2.6 2.6 0 0 1 0 3.8" />,
  inquiries: <path d="M2.5 9.2l1.8-5.7h7.4l1.8 5.7v4.3h-11zM2.5 9.2h3.2l1 1.4h2.6l1-1.4h3.2" />,
  funding: <path d="M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2zM6 6h4M6 8.5h4" />,
  payments: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.6" />
      <path d="M2 6.6h12M4.5 10h2.6" />
    </>
  ),
  subscriptions: <path d="M3 7.2a5 5 0 0 1 8.6-3.4L13 5.2M13 2.6v2.6h-2.6M13 8.8a5 5 0 0 1-8.6 3.4L3 10.8M3 13.4v-2.6h2.6" />,
  users: (
    <>
      <circle cx="8" cy="5.4" r="2.5" />
      <path d="M3.2 13.5a4.8 4.8 0 0 1 9.6 0" />
    </>
  ),
  risk: <path d="M8 2l5 1.9v4c0 3-2.2 5.2-5 6.1-2.8-.9-5-3.1-5-6.1v-4z" />,
  landingMedia: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M2.5 10.6l3-3 3 3 2-2 3 3" />
      <circle cx="10.4" cy="6" r="1" />
    </>
  ),
  legacy: (
    <>
      <rect x="2.5" y="3" width="11" height="3" rx=".8" />
      <path d="M3.5 6v7h9V6M6.5 8.6h3" />
    </>
  ),
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="admin-nav-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.legacy}
    </svg>
  );
}
