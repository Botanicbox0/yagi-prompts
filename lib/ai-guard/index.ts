/**
 * The prompt guard: keeps the internal text that steers our model calls (system prompts, profiles,
 * compiler rules, presets) from reaching a customer. One module for every model call site.
 * docs/PROMPT-GUARD.md says what it protects against, what it cannot, and how to adopt a site.
 */
import 'server-only';

export {
  canaryLine,
  DATA_LINE,
  DATA_TAG,
  defaultGuardLog,
  guardRequest,
  neutraliseTags,
  newCanary,
  NON_DISCLOSURE_RULE,
  type GuardCheckOptions,
  type GuardedRequest,
  type GuardLog,
  type GuardLogLine,
  type GuardRequestInput,
  type GuardVerdict,
  type PromptGuardMode,
} from './request';
export {
  CANARY_FRAGMENT,
  CANARY_SPREAD,
  checkOutgoing,
  dictatedSpans,
  GAPPED_MAX_GAP,
  GAPPED_MIN_CONTENT_WORDS,
  GAPPED_MIN_WORDS,
  RUN_HANGUL,
  RUN_LATIN_CHARS,
  RUN_WORDS,
  SHARE_HANGUL_LIMIT,
  SHARE_HANGUL_N,
  SHARE_MIN_WINDOWS,
  SHARE_WORDS_COUNT,
  SHARE_WORDS_LIMIT,
  SHARE_WORDS_N,
  UNREADABLE_BASE64,
  UNREADABLE_TOKENS,
  type FieldRefusal,
  type FieldShape,
  type FieldSignals,
  type GuardReason,
  type OutgoingInput,
  type OutgoingVerdict,
} from './outgoing';
