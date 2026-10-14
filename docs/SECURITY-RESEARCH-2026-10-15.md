# TWINGS security selection — 2026-10-15

## Observation method

Fetched GitHub's [daily](https://github.com/trending?since=daily), [weekly](https://github.com/trending?since=weekly) and [monthly](https://github.com/trending?since=monthly) Trending HTML on 2026-10-15 KST. The exact URLs, UTC capture times and repository headings are retained in [the snapshot](qa/github-trending-2026-10-15.json). These are GitHub's visible trending lists at capture time, not a reproducible ranking of every repository by stars gained over exactly 24 hours / 7 days / 30 days. Lists can change and the capture is not an endorsement or code audit.

## Security-related candidates in those lists

| Repository | Observed window | Fit for TWINGS | Decision |
|---|---|---|---|
| [vxcontrol/pentagi](https://github.com/vxcontrol/pentagi) | Daily | Autonomous penetration-testing workflow; does not prevent scraping at runtime | Consider only in an isolated, explicitly scoped staging security exercise; do not give an agent production credentials |
| [NationalSecurityAgency/ghidra](https://github.com/NationalSecurityAgency/ghidra) | Daily, weekly, monthly | Reverse engineering native binaries | Not useful for protecting Next.js server recipes; do not add a runtime dependency |
| [morluto/rea](https://github.com/morluto/rea) | Daily, weekly | Reverse-engineering analysis | Useful perspective on what shipped artifacts reveal; not a confidentiality control |
| [alibaba/open-code-review](https://github.com/alibaba/open-code-review) | Monthly | Automated code review | Evaluate private-code handling, license and false positives separately before enabling; no source upload in this change |
| [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) | Monthly | Agent execution isolation | Relevant if TWINGS later runs untrusted tools/agents; not a replacement for application authorization |

## Controls selected for this change

[Gitleaks](https://github.com/gitleaks/gitleaks) was evaluated separately; it was **not** present in the captured lists. Adopted its CLI as a CI secret scanner, pinned to v8.30.1 and verified with the official release checksum. CI scans the branch delta with values redacted; the local audit scans source files. This does not establish that all past Git history or provider logs are clean.

[Arcjet JS](https://github.com/arcjet/arcjet-js) and [Semgrep](https://github.com/semgrep/semgrep) were also evaluated separately, not represented as trending winners. Do not add a hosted security SDK merely because it is popular. The initial implementation uses transactional per-user quotas, explicit session authorization, bounded request bodies, same-origin mutations and strict schema validation. Edge bot challenges / distributed IP limits and a tuned SAST ruleset can be evaluated with real traffic and privacy constraints before adoption.

Custom `security:client` follows the TypeScript client import graph and rejects server-only/private modules. `security:built` additionally checks public build artifacts for source maps and known private portrait-prompt canaries. The existing anonymous authorization sweep checks actual HTTP bytes. These overlap deliberately: an import rule alone cannot prove every response is safe, and a few canaries cannot prove absence of every secret.

Supplier recipes enter a private, deny-all-RLS review queue. Accepted templates are hidden recipes, and a database guard prevents the legacy editor from changing their confidentiality or attribution. Only the studio can approve/publish. New customer DTOs select explicit columns; URL submissions are parsed rather than fetched, removing the SSRF path. Claim media uses an admin-only short-lived output access route. No source-face media is added to that route.

Global responses receive nosniff, strict-origin referrer policy, same-origin framing and a narrowly compatible CSP. Public source maps are explicitly disabled. A full script CSP/nonce rollout needs separate compatibility work for Next.js and payment integrations. Security headers do not replace authorization.

The GitHub API confirmed the repository is private during this task (only the boolean result was recorded). Browser-delivered HTML/JS/media remain copyable. The defensible commitment is to keep private recipes and server modules out of those responses, monitor abuse, and limit authorized generation cost. No tool can guarantee that nobody will scrape a public service or infer aspects of a recipe from outputs.

## Release and follow-up gates

- Apply new cloud schema only through owner/Director. No production migration or security attack was performed.
- Enable edge controls based on actual abusive traffic without blocking search engines from the public catalog.
- Review dependency advisories and private-repo permissions continuously through the existing release process. No recurring automation was created.
- Review account closure and legally required financial-record retention before activating reward ledgers. Financial records deliberately resist deletion; a dedicated anonymization/retention workflow is still required.
- Validate provider prices, reward policy, creator contract and payout reversals before money-bearing launch. A pinned template recipe is not a guarantee that an external provider will never change its price.
