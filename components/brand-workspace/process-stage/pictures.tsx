import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import type { ProcessPictureId } from './model';
import s from './process-stage.module.css';

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={s.picGlyph}>
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={s.picPlay}>
      <path d="M7 5.2v9.6l8-4.8-8-4.8Z" />
    </svg>
  );
}

export function ProcessPicture({
  id,
  pic,
  activationKey,
}: {
  id: ProcessPictureId;
  pic: CampaignOpsCopy['pic'];
  activationKey?: string;
}) {
  const key = activationKey ?? id;
  switch (id) {
    case 'c-brief':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picTitle}>{pic.brief.title}</span>
              <span className={`${s.picPillAccent} ${s.picPop}`}>{pic.brief.review}</span>
            </div>
            <div className={s.picFieldList}>
              <div className={s.picFieldRow}>
                <span className={s.picFieldLabel}>{pic.brief.goal}</span>
                <span className={s.picBarGrow} />
              </div>
              <div className={s.picFieldRow}>
                <span className={s.picFieldLabel}>{pic.brief.video}</span>
                <span className={`${s.picBarGrow} ${s.picBarGrowMid}`} />
              </div>
              <div className={s.picFieldRow}>
                <span className={s.picFieldLabel}>{pic.brief.schedule}</span>
                <span className={`${s.picBarGrow} ${s.picBarGrowShort}`} />
              </div>
            </div>
          </div>
        </div>
      );

    case 'c-template':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={s.picTemplateStage}>
            <div className={`${s.picVerticalFrame} ${s.picSlideIn}`}>
              <img
                src="/reel/brands/house-runway-1080p.jpg"
                alt=""
                loading="lazy"
                decoding="async"
                className={`${s.picStillImg} ${s.picStillTop}`}
              />
              <div className={s.picPlayCircle}>
                <PlayGlyph />
              </div>
            </div>
            <div className={`${s.picCard} ${s.picArriveRight}`}>
              <div className={s.picHeader}>
                <span className={s.picTitle}>{pic.template.title}</span>
                <span className={s.picDot} />
              </div>
              <div className={s.picSkeletonStack}>
                <span className={s.picLine} />
                <span className={s.picLineMid} />
                <span className={s.picLineShort} />
              </div>
              <div className={s.picActionRow}>
                <span className={`${s.picPillAccent} ${s.picPop}`}>
                  <CheckGlyph />
                  <span>{pic.template.approved}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      );

    case 'c-recruit':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picPill}>{pic.recruit.open}</span>
              <span className={s.picDot} />
            </div>
            <div className={s.picRecruitRow}>
              <div className={s.picRecruitCircles}>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger1}`} />
                </span>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger2}`} />
                </span>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger3}`} />
                </span>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger4}`} />
                </span>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger5}`} />
                </span>
                <span className={s.picCircleSlot}>
                  <span className={`${s.picCircleBrightFill} ${s.picDotStagger6}`} />
                </span>
              </div>
              <span className={s.picPillAccent}>{pic.recruit.applicants}</span>
            </div>
          </div>
        </div>
      );

    case 'c-pick':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picPill}>{pic.pick.picked}</span>
              <span className={s.picDot} />
            </div>
            <div className={s.picCircleGrid}>
              <span className={`${s.picCircleLg} ${s.picCirclePicked} ${s.picPop}`}>
                <CheckGlyph />
              </span>
              <span className={s.picCircleLg} />
              <span className={`${s.picCircleLg} ${s.picCirclePicked} ${s.picPop}`}>
                <CheckGlyph />
              </span>
              <span className={s.picCircleLg} />
              <span className={s.picCircleLg} />
              <span className={s.picCircleLg} />
            </div>
            <div className={s.picPickFooter}>
              <span className={`${s.picPillBright} ${s.picArriveRight}`}>
                <CheckGlyph />
                <span>{pic.pick.confirmed}</span>
              </span>
            </div>
          </div>
        </div>
      );

    case 'c-post':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={s.picPostStage}>
            <div className={`${s.picPhone} ${s.picSlideIn}`}>
              <div className={s.picPhoneScreen}>
                <img
                  src="/reel/brands/y2k-flip-phone.jpg"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`${s.picStillImg} ${s.picStillTop}`}
                />
                <div className={s.picPlayCircle}>
                  <PlayGlyph />
                </div>
              </div>
            </div>
            <div className={`${s.picPostAside} ${s.picArriveRight}`}>
              <span className={`${s.picPillAccent} ${s.picPop}`}>
                <CheckGlyph />
                <span>{pic.post.posted}</span>
              </span>
              <div className={s.picPhoneFoot}>
                <span className={s.picLine} />
                <span className={s.picLineMid} />
              </div>
            </div>
          </div>
        </div>
      );

    case 'c-report':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picTitle}>{pic.report.title}</span>
              <span className={s.picDot} />
            </div>
            <div className={s.picBars}>
              <div className={s.picBarRow}>
                <span className={s.picFieldLabel}>{pic.report.views}</span>
                <span className={s.picMetricTrack}>
                  <span className={`${s.picMetricFillAccent} ${s.picGrowBar}`} />
                </span>
              </div>
              <div className={s.picBarRow}>
                <span className={s.picFieldLabel}>{pic.report.reactions}</span>
                <span className={s.picMetricTrack}>
                  <span className={`${s.picMetricFillPrimary} ${s.picGrowBar}`} />
                </span>
              </div>
            </div>
          </div>
        </div>
      );

    case 'p-request':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={s.picSplitMain}>
            <div className={`${s.picCard} ${s.picSlideIn}`}>
              <div className={s.picHeader}>
                <span className={s.picTitle}>{pic.request.title}</span>
                <span className={s.picDot} />
              </div>
              <div className={s.picFieldList}>
                <div className={s.picOutlineRowAccent}>
                  <span className={s.picBarGrow} />
                </div>
                <div className={s.picOutlineRow}>
                  <span className={`${s.picBarGrow} ${s.picBarGrowMid}`} />
                </div>
                <div className={s.picOutlineRow}>
                  <span className={`${s.picBarGrow} ${s.picBarGrowShort}`} />
                </div>
              </div>
            </div>
            <div className={`${s.picSideCard} ${s.picArriveRight}`}>
              <div className={s.picSidePreview}>
                <img
                  src="/reel/landing/v7/hero.jpg"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={s.picStillImg}
                />
                <div className={s.picPlayCircle}>
                  <PlayGlyph />
                </div>
              </div>
              <span className={s.picLineMid} />
              <span className={s.picLineShort} />
            </div>
          </div>
        </div>
      );

    case 'p-board':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picTitle}>{pic.board.title}</span>
              <span className={`${s.picPillAccent} ${s.picPop}`}>
                <CheckGlyph />
                <span>{pic.board.approve}</span>
              </span>
            </div>
            <div className={s.picCutGrid}>
              <div className={`${s.picCutTile} ${s.picDotStagger1}`}>
                <span className={s.picCutFrame}>
                  <img
                    src="/reel/studio-demo/designed-format.jpg"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={s.picStillImg}
                  />
                </span>
                <span className={s.picLineMid} />
                <span className={s.picLineShort} />
              </div>
              <div className={`${s.picCutTile} ${s.picDotStagger2}`}>
                <span className={s.picCutFrame}>
                  <img
                    src="/reel/campaigns/highteen.jpg"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={s.picStillImg}
                  />
                </span>
                <span className={s.picLine} />
                <span className={s.picLineShort} />
              </div>
              <div className={`${s.picCutTile} ${s.picDotStagger3}`}>
                <span className={s.picCutFrame}>
                  <img
                    src="/reel/campaigns/beauty-rose.jpg"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={s.picStillImg}
                  />
                </span>
                <span className={s.picLineMid} />
                <span className={s.picLine} />
              </div>
            </div>
          </div>
        </div>
      );

    case 'p-draft':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={s.picSplitMain}>
            <div className={`${s.picCard} ${s.picDraftCard} ${s.picSlideIn}`}>
              <div className={s.picHeader}>
                <span className={s.picTitle}>{pic.draft.title}</span>
                <span className={s.picDot} />
              </div>
              <div className={s.picPlayerWrap}>
                <div className={s.picPlayerBox}>
                  <img
                    src="/reel/brands/production-paris.jpg"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={s.picStillImg}
                  />
                  <div className={s.picPlayCircle}>
                    <PlayGlyph />
                  </div>
                  <span className={s.picScrubber}>
                    <span className={s.picScrubberFill} />
                  </span>
                </div>
                <span className={`${s.picPinDot} ${s.picPop}`} />
                <span className={s.picPinConnector} />
              </div>
            </div>
            <div className={`${s.picNoteBubble} ${s.picArriveRight}`}>
              <span className={s.picPillBright}>{pic.draft.note}</span>
              <div className={s.picNoteLines}>
                <span className={s.picNoteLine} />
                <span className={`${s.picNoteLine} ${s.picLineMid}`} />
                <span className={`${s.picNoteLine} ${s.picLineShort}`} />
              </div>
            </div>
          </div>
        </div>
      );

    case 'p-revise':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={s.picCompareGrid}>
            <div className={`${s.picComparePane} ${s.picSlideIn}`}>
              <span className={s.picPill}>{pic.revise.before}</span>
              <div className={s.picCompareScreenMuted}>
                <img
                  src="/reel/landing/v7/film-tutu.jpg"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={s.picStillImgMuted}
                />
                <div className={s.picPlayCircle}>
                  <PlayGlyph />
                </div>
              </div>
              <span className={s.picLineMid} />
            </div>
            <div className={`${s.picComparePane} ${s.picComparePaneBright} ${s.picArriveRight}`}>
              <span className={`${s.picPillAccent} ${s.picPop}`}>
                <CheckGlyph />
                <span>{pic.revise.after}</span>
              </span>
              <div className={s.picCompareScreen}>
                <img
                  src="/reel/landing/v7/rx-beauty-world.jpg"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={s.picStillImg}
                />
                <div className={s.picPlayCircle}>
                  <PlayGlyph />
                </div>
              </div>
              <span className={s.picLine} />
            </div>
          </div>
        </div>
      );

    case 'p-done':
      return (
        <div className={s.picWrap} aria-hidden="true" data-process-pic={id}>
          <div key={key} className={`${s.picWideCard} ${s.picSlideIn}`}>
            <div className={s.picHeader}>
              <span className={s.picTitle}>{pic.done.title}</span>
              <span className={s.picDot} />
            </div>
            <div className={s.picDoneSplit}>
              <div className={s.picDoneMedia}>
                <img
                  src="/reel/brands/tea-editorial.jpg"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`${s.picStillImg} ${s.picStillDoneSubject}`}
                />
                <div className={s.picPlayCircle}>
                  <PlayGlyph />
                </div>
              </div>
              <div className={s.picDoneMeta}>
                <div className={s.picSkeletonStack}>
                  <span className={s.picLine} />
                  <span className={s.picLineMid} />
                  <span className={s.picLineShort} />
                </div>
                <span className={`${s.picPillAccent} ${s.picPop}`}>
                  <CheckGlyph />
                  <span>{pic.done.saved}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      );
  }
}
