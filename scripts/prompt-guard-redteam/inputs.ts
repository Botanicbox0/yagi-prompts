import { z } from 'zod';
import { STUDIO_ASSET_ROLES } from '@/lib/brand-studio/contracts';
import type { DirectorCompileInput } from '@/lib/brand-studio/director/types';
import type { EnhanceInput } from '@/lib/brand-studio/enhancer/types';
import attacksJson from './attacks.json';
import benignJson from './benign.json';
import type { InputClass, RedteamInputItem } from './types';

const RedteamReferenceSchema = z.object({
  label: z.string().min(1),
  role: z.enum(STUDIO_ASSET_ROLES).optional(),
  use: z.string().optional(),
  avoid: z.string().optional(),
});

const RedteamBrandSchema = z.object({
  name: z.string().optional(),
  tone: z.string().optional(),
  palette: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
});

export const RedteamInputItemSchema = z.object({
  id: z.string().min(1),
  inputClass: z.enum(['attack', 'benign']),
  category: z.string().min(1),
  locale: z.enum(['ko', 'en']),
  prompt: z.string().min(1),
  references: z.array(RedteamReferenceSchema).optional(),
  brand: RedteamBrandSchema.nullable().optional(),
});

const DatasetSchema = z.array(RedteamInputItemSchema);

export function loadAttacks(): RedteamInputItem[] {
  const parsed = DatasetSchema.parse(attacksJson);
  for (const item of parsed) {
    if (item.inputClass !== 'attack') throw new Error(`Expected inputClass=attack for ${item.id}`);
  }
  return parsed;
}

export function loadBenign(): RedteamInputItem[] {
  const parsed = DatasetSchema.parse(benignJson);
  for (const item of parsed) {
    if (item.inputClass !== 'benign') throw new Error(`Expected inputClass=benign for ${item.id}`);
  }
  return parsed;
}

export function loadInputs(classes: readonly InputClass[] = ['attack', 'benign'], limit?: number | null): RedteamInputItem[] {
  const all: RedteamInputItem[] = [];
  if (classes.includes('attack')) all.push(...loadAttacks());
  if (classes.includes('benign')) all.push(...loadBenign());
  if (limit !== undefined && limit !== null) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got ${limit}`);
    return all.slice(0, limit);
  }
  return all;
}

function mapReferences(item: RedteamInputItem): EnhanceInput['references'] {
  return (item.references ?? []).map((ref, idx) => ({
    index: idx + 1,
    kind: 'image' as const,
    label: ref.label,
    ...(ref.role ? { role: ref.role } : {}),
    ...(ref.use ? { use: ref.use } : {}),
    ...(ref.avoid ? { avoid: ref.avoid } : {}),
  }));
}

export function toEnhanceInput(item: RedteamInputItem): EnhanceInput {
  return {
    kind: 'image',
    profile: 'seedream',
    locale: item.locale,
    prompt: item.prompt,
    references: mapReferences(item),
    brand: item.brand ?? null,
    video: null,
  };
}

export function toDirectorInput(item: RedteamInputItem): DirectorCompileInput {
  return {
    kind: 'video',
    profile: 'seedance',
    locale: item.locale,
    prompt: item.prompt,
    references: mapReferences(item),
    brand: item.brand ?? null,
    video: { seconds: 6, aspect: '9:16', audio: 'on' },
  };
}

export function customerExemptTexts(item: RedteamInputItem): string[] {
  const out: string[] = [item.prompt];
  for (const ref of item.references ?? []) {
    out.push(ref.label);
    if (ref.use) out.push(ref.use);
    if (ref.avoid) out.push(ref.avoid);
  }
  if (item.brand?.name) out.push(item.brand.name);
  if (item.brand?.tone) out.push(item.brand.tone);
  for (const rule of item.brand?.rules ?? []) out.push(rule);
  return out.filter((s) => s.trim().length > 0);
}
