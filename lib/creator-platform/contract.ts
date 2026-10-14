import { z } from 'zod';
export const PlatformInput = z.discriminatedUnion('action', [
  z.object({action:z.literal('request'),requestId:z.uuid(),message:z.string().trim().min(5).max(2000),reference:z.string().max(2048).default('')}).strict(),
  z.object({action:z.literal('reply'),requestId:z.uuid(),threadId:z.uuid(),message:z.string().trim().min(1).max(2000)}).strict(),
  z.object({action:z.literal('rating'),renderId:z.uuid(),stars:z.number().int().min(1).max(5),message:z.string().trim().max(1000).default('')}).strict(),
  z.object({action:z.literal('claim'),renderId:z.uuid(),url:z.string().max(2048),disclosure:z.literal(true),ownership:z.literal(true)}).strict(),
  z.object({action:z.literal('format'),requestId:z.uuid(),title:z.string().trim().min(3).max(120),recipe:z.string().trim().min(20).max(20000),example:z.string().max(2048),medium:z.enum(['image','video']),rights:z.literal(true)}).strict(),
]);
export type PlatformInput = z.infer<typeof PlatformInput>;
export class PlatformError extends Error { constructor(public code:string) { super(code); } }
export function demand(value:unknown,code='invalid'):asserts value { if (!value) throw new PlatformError(code); }
export type RatingSummary={count:number;average:number|null;distribution:number[];studioScore:number|null};
