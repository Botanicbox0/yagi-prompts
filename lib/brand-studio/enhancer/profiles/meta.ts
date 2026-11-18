/**
 * What every profile file declares about itself, so a reader (and a job record) can tell which version of
 * the rules wrote a prompt, what each rule rests on and when it was last checked against the provider.
 *
 * Rule tags used in the profile files' comments:
 *   [official]  the provider's own prompting guide or API document (URL in `sources`)
 *   [aggregator] the Sunra catalogue / schema the studio calls through (URL in `sources`)
 *   [house]     our own measurement or a studio decision on evidence (named, never a private path)
 *   [founder: YYYY-MM-DD] a decision by the founder on that date
 *
 * Changing a rule: bump `version`, add a line to ./CHANGELOG.md, and attach the before/after output of
 * `scripts/architect-eval.ts` to the PR (docs/BRAND-STUDIO-V2.md §8.1).
 */

export interface ProfileSource {
  url: string;
  /** The day the page was read (YYYY-MM-DD). */
  seen: string;
  /** What in the profile rests on it. */
  claim: string;
}

export interface ProfileHeader {
  /** `seedream`, `nano-banana`, `nano-banana-2.1` … the block's own name. */
  id: string;
  /** `YYYY-MM-DD.n`; recorded on every job as `work.enhancer.profileVersion`. */
  version: string;
  /** Studio model ids (lib/brand-studio/models.ts) the block was written for. */
  models: readonly string[];
  sources: readonly ProfileSource[];
  /** The last day every source above was re-read and the rules still matched. */
  lastVerified: string;
}

/** A model-specific block that follows the family block in the system instruction. */
export interface ModelBlock {
  header: ProfileHeader;
  text: string;
}
