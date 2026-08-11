import { en, type Dictionary } from '@/messages/en';
import { ko } from '@/messages/ko';
import type { Locale } from './config';

const DICTIONARIES: Record<Locale, Dictionary> = { en, ko };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
