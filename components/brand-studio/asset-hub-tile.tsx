"use client";
/**
 * One picture on the assets page, and the sheet it opens.
 *
 * The tile is the picture: at rest it carries at most a length badge (video, audio) and a filled heart.
 * Pointer hover or keyboard focus brings up a quiet foot with the item's name, one main action and a
 * "more" menu. Touch screens have no hover, so a tap opens the sheet, which lists every action.
 */
import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import type { SendTransport } from "@/components/brand-rooms/chat/transport";
import { FileSendButton, FileSendHost, FileSendPanelSlot, FileSendShareLabel, SendPageScope, isSendEscapeRecent } from "@/components/brand-send/file-send";
import type { SendLocale, ViewerSendProp } from "@/components/brand-send/model";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { clampRatio, hubEntryToSendRef, humanTitle, tileSources, type HubAction, type HubDeliverable, type HubEntry } from "./asset-hub-model";
import s from "./asset-hub.module.css";
import { useModal } from "./modal";
import { RailIcon } from "./rail/icons";
import { RailMenu, type MenuItem } from "./rail/parts";
import { clock, fill, type LibraryCopy } from "./rail/text";

const marker = (action: HubAction): Record<`data-${string}`, string> => ({ [action.marker]: "" });

function PlayGlyph() {
  return (
    <svg className={s.glyph} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.2 1.9v8.2a.5.5 0 0 0 .76.43l6.6-4.1a.5.5 0 0 0 0-.86l-6.6-4.1a.5.5 0 0 0-.76.43Z" />
    </svg>
  );
}

function Heart({ liked, label, onPress, className }: { liked: boolean; label: string; onPress(): void; className?: string }) {
  return (
    <button type="button" className={className} aria-pressed={liked} aria-label={label} title={label} onClick={onPress} data-asset-hub-like>
      <RailIcon name="heart" filled={liked} />
    </button>
  );
}

export interface HubTileProps {
  entry: HubEntry;
  copy: LibraryCopy;
  /** What assistive tech calls the item: its name, else its kind. */
  name: string;
  liked: boolean;
  main: HubAction | null;
  more: HubAction[];
  moreLabel: string;
  /**
   * A small tile (a project's cover row, the shared-material strip): no name and no pill on the picture; the
   * main action is the first item of the "more" menu, as on every tile. The sheet is unchanged.
   */
  compact?: boolean;
  soundMarker?: boolean;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?(): void;
  menuOpen: boolean;
  onMenu(open: boolean): void;
  onOpen(): void;
  onLike(): void;
  onAction(action: HubAction): void;
}

export function HubTile({ entry, copy, name, liked, main, more, moreLabel, compact = false, soundMarker = false, selecting = false, selected = false, onToggleSelect, menuOpen, onMenu, onOpen, onLike, onAction }: HubTileProps) {
  // A stored size is trusted; a guessed one is corrected from the media itself once it loads.
  const [measured, setMeasured] = useState<number | null>(null);
  const [hovering, setHovering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const ratio = measured ?? entry.ratio;
  const still = entry.thumbUrl ?? (entry.kind === "image" ? entry.url : null);
  const sharper = tileSources(entry);

  const measure = (width: number, height: number) => {
    if (!entry.sized && width > 0 && height > 0) setMeasured(clampRatio(width / height));
  };
  const onImage = (event: SyntheticEvent<HTMLImageElement>) => measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
  const onVideoMeta = (event: SyntheticEvent<HTMLVideoElement>) => measure(event.currentTarget.videoWidth, event.currentTarget.videoHeight);

  // The menu lists everything, the main action first: on a narrow tile the pill is not drawn, and the menu is the way.
  const items: MenuItem[] = (main ? [main, ...more] : more).map((action) => ({
    key: action.key,
    label: action.label,
    href: action.href,
    attrs: marker(action),
    run: action.href ? undefined : () => onAction(action),
  }));

  return (
    <li
      className={s.tile}
      style={{ "--r": ratio } as CSSProperties}
      data-asset-hub-card={entry.key}
      data-origin={entry.origin}
      data-kind={entry.kind}
      data-asset-hub-sound={soundMarker ? "" : undefined}
      data-selected={selecting && selected ? "" : undefined}
      data-menu-open={menuOpen ? "" : undefined}
      data-compact={compact ? "" : undefined}
      onPointerEnter={(event) => {
        if (!selecting && event.pointerType === "mouse") setHovering(true);
      }}
      onPointerLeave={() => {
        setHovering(false);
        setPlaying(false);
      }}
    >
      <button
        type="button"
        className={s.tileOpen}
        aria-label={fill(copy.item.view, { name })}
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggleSelect : onOpen}
        data-asset-hub-open
      >
        {entry.kind === "audio" ? (
          <span className={s.audioStage}>
            <RailIcon name="wave" />
            {entry.label && <span className={s.audioName}>{entry.label}</span>}
          </span>
        ) : still ? (
          <picture>
            {sharper && <source media="(min-width: 1024px)" srcSet={sharper.srcSet} sizes={sharper.sizes} />}
            <img src={still} alt="" loading="lazy" decoding="async" draggable={false} onLoad={onImage} />
          </picture>
        ) : (
          <video src={`${entry.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" onLoadedMetadata={onVideoMeta} />
        )}
        {!selecting && entry.kind === "video" && hovering && (
          <video
            className={s.tileFilm}
            src={entry.url}
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            tabIndex={-1}
            aria-hidden="true"
            data-playing={playing ? "" : undefined}
            onPlaying={() => setPlaying(true)}
            data-asset-hub-preview
          />
        )}
      </button>

      {entry.kind !== "image" && (
        <span className={s.badge} data-asset-hub-length>
          {entry.kind === "video" ? <PlayGlyph /> : <RailIcon name="wave" />}
          {entry.seconds != null ? clock(entry.seconds) : copy.item[entry.kind]}
        </span>
      )}

      {selecting ? (
        <span className={s.selectMark} data-selected={selected ? "" : undefined} aria-hidden="true">
          {selected && (
            <svg viewBox="0 0 12 12" focusable="false">
              <path d="M2.4 6.2 4.9 8.7 9.6 3.5" />
            </svg>
          )}
        </span>
      ) : (
        <>
          <Heart liked={liked} label={fill(liked ? copy.item.unlike : copy.item.like, { name })} onPress={onLike} className={s.heart} />

          <div className={s.foot}>
            {!compact && entry.label && entry.kind !== "audio" && <p className={s.footTitle}>{entry.label}</p>}
            <div className={s.footActions}>
              {!compact && main && (
                <a className={s.footMain} href={main.href} {...marker(main)}>
                  {main.label}
                </a>
              )}
              {items.length > 0 && <RailMenu open={menuOpen} label={moreLabel} items={items} onToggle={onMenu} className={s.footMore} />}
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * A campaign deliverable in the same tile: the whole picture is a link to its project's review, where it is
 * approved, commented on and downloaded. It has no actions of its own here, so it has no menu and no sheet.
 */
export function HubLinkTile({ item, href, copy, compact = false }: { item: HubDeliverable; href: string; copy: LibraryCopy; compact?: boolean }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const kind = item.kind === "file" || !item.url || broken ? "file" : item.kind;
  const title = humanTitle(item.title);
  const name = title ?? (kind === "video" ? copy.item.video : copy.item.image);
  const measure = (width: number, height: number) => {
    if (width > 0 && height > 0) setMeasured(clampRatio(width / height));
  };
  return (
    <li
      className={s.tile}
      style={{ "--r": measured ?? (kind === "video" ? 9 / 16 : 4 / 5) } as CSSProperties}
      data-asset-hub-card={`c:${item.id}`}
      data-origin="deliverable"
      data-kind={kind}
      data-compact={compact ? "" : undefined}
    >
      <a className={s.tileOpen} href={href} aria-label={`${fill(copy.item.view, { name })} · ${copy.hub.deliverableOpen}`} data-asset-hub-deliverable>
        {kind === "image" ? (
          <img
            src={item.url!}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={(event) => measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            onError={() => setBroken(true)}
          />
        ) : kind === "video" ? (
          <video
            src={`${item.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden="true"
            onLoadedMetadata={(event) => measure(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className={s.audioStage}>{title && <span className={s.audioName}>{title}</span>}</span>
        )}
      </a>
      {kind === "video" && (
        <span className={s.badge} data-asset-hub-length>
          <PlayGlyph />
          {copy.item.video}
        </span>
      )}
      {!compact && (
        <div className={s.foot}>
          {title && kind !== "file" && <p className={s.footTitle}>{title}</p>}
          <p className={s.footNote}>{copy.hub.deliverableOpen}</p>
        </div>
      )}
    </li>
  );
}

export interface HubDetailProps {
  entry: HubEntry;
  copy: LibraryCopy;
  name: string;
  liked: boolean;
  main: HubAction | null;
  more: HubAction[];
  onLike(): void;
  onAction(action: HubAction): void;
  onClose(): void;
  send?: (ViewerSendProp & { locale?: SendLocale; transport?: SendTransport }) | null;
  sendJob?: Pick<StudioJobView, "kind" | "model" | "purpose"> | null;
}

/** The sheet a tile opens: the item at full size, what it is, and every action (the touch path). */
export function HubDetail({
  entry,
  copy,
  name,
  liked,
  main,
  more,
  onLike,
  onAction,
  onClose,
  send,
  sendJob,
}: HubDetailProps) {
  const ref = useModal();
  const film = useRef<HTMLVideoElement>(null);
  const h = copy.hub;
  const prompt = entry.prompt.trim();

  const sendLocale: SendLocale = send?.locale ?? "ko";
  const sendRef = send ? hubEntryToSendRef(entry, sendJob) : null;

  useEffect(() => {
    // Muted autoplay is allowed everywhere; a refusal just leaves the first frame and the controls.
    void film.current?.play().catch(() => {});
  }, []);

  const dialogNode = (
    <dialog
      ref={ref}
      className={s.detail}
      aria-label={name}
      data-asset-hub-detail={entry.key}
      onCancel={(event) => {
        event.preventDefault();
        if (send && isSendEscapeRecent()) return;
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={s.detailBody}>
        <div className={s.detailStage} data-kind={entry.kind}>
          {entry.kind === "image" ? (
            <img src={entry.url} alt={name} />
          ) : entry.kind === "video" ? (
            <video ref={film} src={entry.url} poster={entry.thumbUrl ?? undefined} controls muted loop playsInline preload="metadata" />
          ) : (
            <>
              <RailIcon name="wave" />
              <audio src={entry.url} controls preload="metadata" />
            </>
          )}
        </div>

        <div className={s.detailSide}>
          <div className={s.detailTop}>
            <span className={s.detailOrigin}>
              {entry.origin === "upload" ? h.sourceUpload : h.sourceGenerated}
              {entry.seconds != null && entry.kind !== "image" ? ` · ${clock(entry.seconds)}` : ""}
            </span>
            <Heart liked={liked} label={fill(liked ? copy.item.unlike : copy.item.like, { name })} onPress={onLike} className={s.detailIcon} />
            <button type="button" className={s.detailIcon} aria-label={copy.close} title={copy.close} onClick={onClose} data-asset-hub-detail-close>
              <RailIcon name="close" />
            </button>
          </div>

          {entry.origin === "upload" ? (
            entry.label ? (
              <h2 className={s.detailTitle}>{entry.label}</h2>
            ) : (
              <p className={s.detailFile}>{entry.title}</p>
            )
          ) : (
            prompt && <p className={s.detailPrompt}>{prompt}</p>
          )}

          {(entry.role || entry.tags.length > 0) && (
            <div className={s.detailTags}>
              {entry.role && <span className={s.detailTag}>{copy.roles[entry.role]}</span>}
              {entry.tags.map((tag) => (
                <span key={tag} className={s.detailTag}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <FileSendHost send={send} fileRef={sendRef} locale={sendLocale} closeLabel={copy.close}>
          <div className={s.detailActions}>
            {main && (
              <a className={s.detailMain} href={main.href} {...marker(main)}>
                {main.label}
              </a>
            )}
            {send && <FileSendButton className={s.detailRow} dataAssetHubSend>{send.copy.action}</FileSendButton>}
            {more.map((action) =>
              action.href ? (
                <a key={action.key} className={s.detailRow} href={action.href} {...marker(action)}>
                  {send && action.key === "share" ? <FileSendShareLabel fallback={action.label} externalLink={send.copy.externalLink} /> : action.label}
                </a>
              ) : (
                <button key={action.key} type="button" className={s.detailRow} onClick={() => onAction(action)} {...marker(action)}>
                  {send && action.key === "share" ? <FileSendShareLabel fallback={action.label} externalLink={send.copy.externalLink} /> : action.label}
                </button>
              ),
            )}
          </div>
          {send && <FileSendPanelSlot />}
          </FileSendHost>
        </div>
      </div>
    </dialog>
  );

  return send ? <SendPageScope>{dialogNode}</SendPageScope> : dialogNode;
}
