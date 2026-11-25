"use client";
/**
 * Shared state for the open brand project across a studio's header chip and workspace (slice 1b).
 *
 * When a page does not mount `ProjectSpineProvider` (flag off, staff view, guest), `useProjectSpine()` returns
 * `null` and every component behaves identically to before the spine.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { STUDIO_ERROR_CODES, type StudioBrandProject, type StudioErrorCode } from "@/lib/brand-studio/contracts";
import {
  OPEN_PROJECT_COOKIE,
  openProjectCookieString,
  parseOpenProjectCookie,
  planGoneNoticeCleanup,
  planProjectSelection,
  rememberOpenedProject,
  replaceProjectUrlParam,
  writeOpenProjectCookie,
  type OpenProject,
  type StudioSpineProps,
} from "@/lib/brand-studio/open-project";
import { STUDIO_ENDPOINT } from "../api";
import type { StudioLocale } from "../copy";
import { removeProjectFromList, type ProjectSpineCopy } from "./model";

export type CreateBrandProjectResult =
  | { ok: true; project: StudioBrandProject }
  | { ok: false; code: StudioErrorCode };

export interface ProjectSpineContextValue {
  organizationId: string;
  locale: StudioLocale;
  copy: ProjectSpineCopy;
  projects: StudioBrandProject[];
  open: OpenProject;
  canCreate: boolean;
  notice: "gone" | null;
  select: (next: OpenProject, options?: { syncUrl?: boolean }) => void;
  createProject: (title: string, requestId: string) => Promise<CreateBrandProjectResult>;
  markProjectGone: (goneId?: string) => void;
  dismissNotice: () => void;
}

const ProjectSpineContext = createContext<ProjectSpineContextValue | null>(null);

export interface ProjectSpineProviderProps {
  organizationId: string;
  locale: StudioLocale;
  copy: ProjectSpineCopy;
  initial: StudioSpineProps;
  /** Optional override for tests; defaults to `POST /api/brand-studio` `{ operation: 'project.create' }`. */
  onCreateProject?: (input: { organizationId: string; requestId: string; title: string }) => Promise<CreateBrandProjectResult>;
  children: ReactNode;
}

async function postProjectCreate(input: {
  organizationId: string;
  requestId: string;
  title: string;
}): Promise<CreateBrandProjectResult> {
  try {
    const response = await fetch(STUDIO_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ operation: "project.create", input }),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: unknown; project?: StudioBrandProject; code?: unknown }
      | null;
    if (response.ok && body?.ok === true && body.project) {
      return { ok: true, project: body.project };
    }
    const rawCode = typeof body?.code === "string" ? body.code : null;
    if (rawCode && (STUDIO_ERROR_CODES as readonly string[]).includes(rawCode)) {
      return { ok: false, code: rawCode as StudioErrorCode };
    }
    if (response.status === 429) return { ok: false, code: "too_many_running" };
    if (response.status === 403) return { ok: false, code: "forbidden" };
    return { ok: false, code: "failed" };
  } catch {
    return { ok: false, code: "failed" };
  }
}

export function ProjectSpineProvider({
  organizationId,
  locale,
  copy,
  initial,
  onCreateProject,
  children,
}: ProjectSpineProviderProps) {
  const [projects, setProjects] = useState<StudioBrandProject[]>(initial.projects);
  const [open, setOpen] = useState<OpenProject>(initial.open);
  const openRef = useRef<OpenProject>(open);
  openRef.current = open;
  const [notice, setNotice] = useState<"gone" | null>(initial.notice);

  // F3: Clean up a gone project without clobbering a valid cookie when the stale id came from the address.
  useEffect(() => {
    const href = typeof window !== "undefined" ? window.location.href : null;
    const plan = planGoneNoticeCleanup({
      notice: initial.notice,
      noticeSource: initial.noticeSource,
      href,
    });
    if (plan.writeUnfiledCookie) {
      writeOpenProjectCookie(organizationId, { kind: "unfiled" });
    }
    if (plan.nextUrl && typeof window !== "undefined") {
      try {
        window.history.replaceState(window.history.state, "", plan.nextUrl);
      } catch {
        // Ignore history errors in restricted environments.
      }
    }
  }, [initial.notice, initial.noticeSource, organizationId]);

  // The project the page opened (by the address or the cookie) is the remembered one from now on, so moving to
  // another studio through the rail keeps it.
  useEffect(() => {
    const remembered = rememberOpenedProject(initial);
    if (remembered) writeOpenProjectCookie(organizationId, remembered);
    // Once per mount: `initial` is the server's resolution of this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  // H4: Runs the tested `planProjectSelection` helper for both cookie serialization and next URL.
  const select = useCallback(
    (next: OpenProject, options?: { syncUrl?: boolean }) => {
      setOpen(next);
      setNotice(null);
      const rawCookie =
        typeof document !== "undefined"
          ? document.cookie
              .split("; ")
              .find((part) => part.startsWith(`${OPEN_PROJECT_COOKIE}=`))
              ?.slice(OPEN_PROJECT_COOKIE.length + 1)
          : null;
      const href = typeof window !== "undefined" ? window.location.href : null;
      const plan = planProjectSelection({
        memory: parseOpenProjectCookie(rawCookie),
        organizationId,
        next,
        href,
        syncUrl: options?.syncUrl,
      });
      if (typeof document !== "undefined" && typeof window !== "undefined") {
        try {
          document.cookie = openProjectCookieString(plan.cookieValue, window.location.protocol === "https:");
        } catch {
          // Cookies blocked: the studio still works for this visit.
        }
      }
      if (plan.nextUrl && typeof window !== "undefined") {
        try {
          window.history.replaceState(window.history.state, "", plan.nextUrl);
        } catch {
          // Ignore history errors in restricted environments.
        }
      }
    },
    [organizationId],
  );

  // F7 & H5: Remove the closed project from the picker list, switch to 미분류, show goneNotice, and clean cookie + URL.
  const markProjectGone = useCallback(
    (goneId?: string) => {
      const removedId = goneId ?? (openRef.current.kind === "project" ? openRef.current.id : null);
      if (removedId) {
        setProjects((current) => removeProjectFromList(current, removedId));
      }
      setOpen({ kind: "unfiled" });
      setNotice("gone");
      writeOpenProjectCookie(organizationId, { kind: "unfiled" });
      if (typeof window !== "undefined") {
        try {
          const nextUrl = replaceProjectUrlParam(window.location.href, { kind: "unfiled" });
          window.history.replaceState(window.history.state, "", nextUrl);
        } catch {
          // Ignore history errors in restricted environments.
        }
      }
    },
    [organizationId],
  );

  const createProject = useCallback(
    async (rawTitle: string, requestId: string): Promise<CreateBrandProjectResult> => {
      const title = rawTitle.trim();
      const runner = onCreateProject ?? postProjectCreate;
      const result = await runner({ organizationId, requestId, title });
      if (result.ok) {
        setProjects((current) => [result.project, ...current.filter((item) => item.id !== result.project.id)]);
        select({ kind: "project", id: result.project.id });
      }
      return result;
    },
    [onCreateProject, organizationId, select],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<ProjectSpineContextValue>(
    () => ({
      organizationId,
      locale,
      copy,
      projects,
      open,
      canCreate: initial.canCreate,
      notice,
      select,
      createProject,
      markProjectGone,
      dismissNotice,
    }),
    [organizationId, locale, copy, projects, open, initial.canCreate, notice, select, createProject, markProjectGone, dismissNotice],
  );

  return <ProjectSpineContext.Provider value={value}>{children}</ProjectSpineContext.Provider>;
}

/** Current brand project spine context, or `null` when the spine is closed for this page. */
export function useProjectSpine(): ProjectSpineContextValue | null {
  return useContext(ProjectSpineContext);
}
