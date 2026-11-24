import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AdultAnswer } from '@/lib/account/adult-age';
import { requireAdult, type AdultRefusal } from '@/lib/account/adult-confirmation';
import { partnerCheckStamp, photoCheckColumnsReady, type PartnerCheckStamp, type SlotPhoto } from './cast-inputs';
import { checkPartnerPhoto, partnerRefusal, type PartnerPhotoVerdict, type PartnerRefusal } from './partner-photo-check';

/**
 * docs/PERSONAL-STUDIO.md §6.1–6.2 — the two rules a partner slot carries while the Sunra face switch is on
 * (`personalSunraFacesOpen()`, checked by the callers so the switch-off path does not even reach this file):
 *
 *   intake       where a partner photo is first handed over (the paid order in lib/renders/cast-form.ts, an
 *                operator's or a store-credit render in lib/renders/service.ts): the 19+ confirmation FIRST —
 *                so a refused account never has the partner's photo sent anywhere — then the 0188 columns the
 *                verdict is written to, then the photo check. Every refusal comes before anything is stored,
 *                before an order exists and before anything is charged.
 *   fulfilment   where a paid order's job is made from a photo bound at intake (and 다시 결제하기, before its new
 *                order): the confirmation again, and a stored pass on the bound photo. The check is not re-run.
 *
 * Every refusal is fail-closed: a missing table or column, an unreadable row or an unchecked photo refuses.
 */

export type PartnerRuleRefusal = AdultRefusal | PartnerRefusal;
export type PartnerPhotoCheck = (photo: SlotPhoto) => Promise<PartnerPhotoVerdict>;

export async function partnerIntake(
  sql: SqlRunner,
  input: { userId: string; photo: SlotPhoto; answer: AdultAnswer | null; now: Date },
  check: PartnerPhotoCheck = checkPartnerPhoto,
): Promise<{ ok: true; stamp: PartnerCheckStamp } | { ok: false; code: PartnerRuleRefusal }> {
  const adult = await requireAdult(sql, input.userId, input.answer, input.now);
  if (!adult.ok) return adult;
  // Without somewhere to keep the verdict, fulfilment could never find the pass: refuse now, not after payment.
  if (!(await photoCheckColumnsReady(sql))) return { ok: false, code: 'partner_check_unavailable' };
  const refused = partnerRefusal(await check(input.photo));
  if (refused) return { ok: false, code: refused };
  return { ok: true, stamp: { checkedAt: input.now } };
}

export async function partnerAtFulfilment(
  sql: SqlRunner,
  input: { userId: string; renderId: string; now: Date },
): Promise<PartnerRuleRefusal | null> {
  const adult = await requireAdult(sql, input.userId, null, input.now);
  if (!adult.ok) return adult.code;
  return (await partnerCheckStamp(sql, input.renderId)) ? null : 'partner_check_unavailable';
}
