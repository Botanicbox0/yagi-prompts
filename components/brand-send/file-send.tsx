'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { SendInviteTransport, SendTransport } from '@/components/brand-rooms/chat/transport';
import type { SendFileRef } from '@/lib/brand-rooms/send-contracts';
import {
  sendFileRefKey,
  type SendLocale,
  type ViewerSendProp,
} from './model';
import { SendPanel } from './send-panel';

let lastSendEscapeAt = 0;

/** Marks the timestamp of an Escape handled inside SendPanel so a browser dialog `cancel` within 100ms does not also close the outer dialog. */
export function markSendEscapeRecent(): void {
  lastSendEscapeAt = Date.now();
}

/** True for 100ms after SendPanel consumed Escape (returns false outside sends or if clocks move backward). */
export function isSendEscapeRecent(): boolean {
  const delta = Date.now() - lastSendEscapeAt;
  return delta >= 0 && delta < 100;
}

interface SendScopeValue {
  closed: boolean;
  markClosed: () => void;
  unsendableKeys: ReadonlySet<string>;
  markUnsendable: (fileKey: string) => void;
}

const SendScopeContext = createContext<SendScopeValue | null>(null);

/**
 * Holds page-lifetime 보내기 availability (`closed`) and per-file initial/post `not_found` state
 * (`unsendableKeys`). Only rendered while `send` is present; nested instances reuse the outermost
 * page scope so closing and reopening modals on the same page keeps `closed` active until reload.
 */
export function SendPageScope({ children }: { children: ReactNode }) {
  const parent = useContext(SendScopeContext);
  const [closed, setClosed] = useState(false);
  const [unsendableKeys, setUnsendableKeys] = useState<ReadonlySet<string>>(() => new Set());

  const markClosed = useCallback(() => {
    setClosed(true);
  }, []);

  const markUnsendable = useCallback((fileKey: string) => {
    setUnsendableKeys((cur) => {
      if (cur.has(fileKey)) return cur;
      const next = new Set(cur);
      next.add(fileKey);
      return next;
    });
  }, []);

  const value = useMemo<SendScopeValue>(
    () => ({ closed, markClosed, unsendableKeys, markUnsendable }),
    [closed, markClosed, markUnsendable, unsendableKeys],
  );

  if (parent) {
    return <>{children}</>;
  }
  return <SendScopeContext.Provider value={value}>{children}</SendScopeContext.Provider>;
}

export interface FileSendRenderState {
  canSend: boolean;
  closed: boolean;
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  panel: ReactNode;
}

export interface FileSendProps {
  send: ViewerSendProp & { locale?: SendLocale; transport?: SendTransport; inviteTransport?: SendInviteTransport };
  fileRef: SendFileRef | null;
  locale: SendLocale;
  closeLabel: string;
  panelHidden?: boolean;
  children: ReactNode | ((ui: FileSendRenderState) => ReactNode);
}

const FileSendContext = createContext<FileSendRenderState | null>(null);

/**
 * Hosts all send state, refs, effects, and panel rendering inside `components/brand-send/`,
 * mounted only when `send` is passed so parent modals add zero hooks. Outer modal Escape stays
 * on the parent `<dialog>` (`onCancel` + `isSendEscapeRecent()`) so inner React layers handle Escape first.
 */
export function FileSend({
  send,
  fileRef,
  locale,
  closeLabel,
  panelHidden = false,
  children,
}: FileSendProps) {
  const scope = useContext(SendScopeContext);
  const [localClosed, setLocalClosed] = useState(false);
  const [localUnsendable, setLocalUnsendable] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const backToSend = useRef(false);

  const closed = scope ? scope.closed : localClosed;
  const unsendableKeys = scope ? scope.unsendableKeys : localUnsendable;

  const markClosed = useCallback(() => {
    if (scope) scope.markClosed();
    else setLocalClosed(true);
    setOpen(false);
  }, [scope]);

  const markUnsendable = useCallback(
    (k: string) => {
      if (scope) {
        scope.markUnsendable(k);
      } else {
        setLocalUnsendable((cur) => {
          if (cur.has(k)) return cur;
          const next = new Set(cur);
          next.add(k);
          return next;
        });
      }
      setOpen(false);
    },
    [scope],
  );

  const fileKey = fileRef ? sendFileRefKey(fileRef) : null;
  const canSend = Boolean(!closed && fileRef && fileKey && !unsendableKeys.has(fileKey));

  const leave = useCallback(() => {
    backToSend.current = true;
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((cur) => !cur);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [fileKey]);

  useEffect(() => {
    if (panelHidden) {
      setOpen(false);
    }
  }, [panelHidden]);

  useEffect(() => {
    if (!open && backToSend.current) {
      backToSend.current = false;
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  const panel = useMemo(
    () =>
      canSend && open && !panelHidden && fileRef ? (
        <SendPanel
          key={fileKey ?? undefined}
          organizationId={send.organizationId}
          fileRef={fileRef}
          copy={send.copy}
          locale={locale}
          transport={send.transport}
          invite={send.invite}
          inviteTransport={send.inviteTransport}
          autoFocus
          closeLabel={closeLabel}
          onClose={leave}
          onClosed={markClosed}
          onUnsendable={markUnsendable}
          onInnerEscape={markSendEscapeRecent}
        />
      ) : null,
    [canSend, closeLabel, fileKey, fileRef, leave, locale, markClosed, markUnsendable, open, panelHidden, send],
  );

  const value = useMemo<FileSendRenderState>(
    () => ({ canSend, closed, open, buttonRef, toggle, panel }),
    [canSend, closed, open, panel, toggle],
  );

  return (
    <FileSendContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </FileSendContext.Provider>
  );
}

export function FileSendHost({
  send,
  fileRef,
  locale,
  closeLabel,
  panelHidden = false,
  children,
}: Omit<FileSendProps, 'send'> & {
  send?: (ViewerSendProp & { locale?: SendLocale; transport?: SendTransport; inviteTransport?: SendInviteTransport }) | null;
}) {
  if (!send) {
    return <>{children}</>;
  }
  return (
    <FileSend send={send} fileRef={fileRef} locale={locale} closeLabel={closeLabel} panelHidden={panelHidden}>
      {children}
    </FileSend>
  );
}

export function FileSendButton({
  className,
  variant,
  dataAction,
  dataAssetHubSend,
  disabled,
  ariaBusy,
  title,
  children,
}: {
  className?: string;
  variant?: string;
  dataAction?: string;
  dataAssetHubSend?: boolean;
  disabled?: boolean;
  ariaBusy?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const ui = useContext(FileSendContext);
  if (!ui?.canSend) return null;
  return (
    <button
      ref={ui.buttonRef}
      type="button"
      className={className}
      data-variant={variant}
      data-action={dataAction}
      data-asset-hub-send={dataAssetHubSend ? '' : undefined}
      aria-expanded={ui.open}
      disabled={disabled}
      aria-busy={ariaBusy}
      title={title}
      onClick={ui.toggle}
    >
      {children}
    </button>
  );
}

export function FileSendShareLabel({ fallback, externalLink }: { fallback: string; externalLink: string }) {
  const ui = useContext(FileSendContext);
  return <>{ui?.closed ? fallback : externalLink}</>;
}

export function FileSendPanelSlot() {
  const ui = useContext(FileSendContext);
  return <>{ui?.panel ?? null}</>;
}
