/**
 * docs/PERSONAL-STUDIO.md §6.1 — the 19+ rule for a template with a partner slot, as pure functions: the
 * make card's year picker and the server read the same ones. Storage is ./adult-confirmation.ts.
 *
 * The rule (proposed, waiting for the founder's confirmation): the person ticked "만 19세 이상이에요" AND
 * this year in Korea (KST) minus the birth year they chose is at least 19. A year difference, not a
 * birthday: someone born in December 2008 counts from 1 January 2027 KST. That is the counting of
 * 청소년보호법 제2조 제1호 단서 ("만 19세가 되는 해의 1월 1일을 맞이한 사람은 제외"); the founder decides
 * whether it is the boundary the terms mean.
 *
 * Only while `TWINGS_PERSONAL_SUNRA_FACES=on` (lib/flags.ts); with the switch off nothing asks or reads this.
 */

export const ADULT_AGE = 19;
/** The picker starts here: sign-up is 14+ (terms), so younger years are not offered. */
export const BIRTH_YEAR_PICKER_MIN_AGE = 14;
/** …and lists this many years back from there. */
export const BIRTH_YEAR_PICKER_SPAN = 86;
/** Anything earlier (or later than this year) is not a birth year; such a field counts as not sent. */
export const BIRTH_YEAR_FLOOR = 1900;

const KST_OFFSET_MS = 9 * 3_600_000;

/** The calendar year in Korea at `now` (UTC+9, no daylight saving). */
export function kstYear(now: Date): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCFullYear();
}

export interface AdultAnswer {
  birthYear: number;
  /** The "만 19세 이상이에요" box as it was sent. */
  attested: boolean;
}

export function isAdultAnswer(answer: AdultAnswer, now: Date): boolean {
  return answer.attested === true && Number.isInteger(answer.birthYear) && kstYear(now) - answer.birthYear >= ADULT_AGE;
}

/** The years the make card offers, newest first: from 14 years ago back `BIRTH_YEAR_PICKER_SPAN` years. */
export function birthYearChoices(now: Date): number[] {
  const newest = kstYear(now) - BIRTH_YEAR_PICKER_MIN_AGE;
  return Array.from({ length: BIRTH_YEAR_PICKER_SPAN + 1 }, (_, index) => newest - index);
}

/** The form field names the make request carries. */
export const BIRTH_YEAR_FIELD = 'birthYear';
export const ADULT_ATTESTED_FIELD = 'adultAttested';

/**
 * The two fields as one answer, or null when no usable birth year was sent (then nothing is recorded).
 * A year with the box left unticked IS an answer — a failing one, kept like any other first answer.
 */
export function parseAdultAnswer(form: FormData, now: Date = new Date()): AdultAnswer | null {
  const raw = form.get(BIRTH_YEAR_FIELD);
  if (typeof raw !== 'string' || !/^\d{4}$/.test(raw.trim())) return null;
  const birthYear = Number(raw.trim());
  if (birthYear < BIRTH_YEAR_FLOOR || birthYear > kstYear(now)) return null;
  return { birthYear, attested: form.get(ADULT_ATTESTED_FIELD) === 'yes' };
}
