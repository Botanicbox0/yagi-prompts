# Live post gallery readiness

A link import previously appeared in the client gallery immediately, even before its thumbnail was
assigned. Live galleries and rankings now show only posts with their own thumbnail or a linked
content image/video preview. The same preview resolver drives readiness and rendering. Adding a
thumbnail makes the card appear on the next page load; removing the last preview hides it again.

The administrator's campaign view still shows every post, with the existing presentation editor and
a Korean/English explanation of the rule. Staff on the brand surface see the same gallery as clients.

This is a presentation gate, not a new access-control or embargo system: authorized clients retain
all measurement totals and CSV evidence. A note explains any difference between total posts and the
visible gallery. Existing published reports keep their frozen presentation. No history, report,
project sharing flag, or database schema changes are needed. The content library (reviewable studio
deliverables) is a separate surface and is unchanged.

Regression coverage: missing thumbnails hidden from live cards/rankings; measured totals retained;
assigning a thumbnail releases the card; administrator sees incomplete cards; all-pending empty
state; approved content preview fallback; frozen report preservation; Korean/English strings.

The no-raw-shortcode fixture now supplies thumbnails so it still exercises visible unnamed cards.
The usage CTA fixture likewise supplies a preview so it exercises a displayed card.

## Verification

- Regression observed red before implementation (ko/en missing cards were displayed).
- `npx tsc --noEmit`: pass.
- `npx vitest run`: 173 files / 1,890 tests pass.
- `npm run build:local`: pass.
- `npm run start:local`: ready on port 3000.
- `npm run sweep:anon`: **SWEEP PASSED — 664/664**.
- An initial sweep at port 4812 failed 44 canonical URL assertions because the build uses the
  default localhost:3000 origin; rerunning the same build on the matching standard port passed.
- No database migration, generation/payment flag change, or external message.
