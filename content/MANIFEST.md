# Content manifest

**Owner**: Yagi. **Status**: template + launch slate, unfilled.

PLAN §9: engineering ships with two polished fixture playbooks carrying clearly-labelled
placeholder media. **Real content is content-ops, not an engineering gate** — nothing in this file
blocks a merge, and everything in it blocks launch.

This is where a playbook is decided *before* it is typed into `/admin`. The editor is deliberately
minimal (§3.8), so the thinking has to happen somewhere, and doing it here means the decision that
actually matters — **which prompts we publish and which we hold** — is made once, in writing, rather
than improvised at 1am inside a form.

---

## How to use it

1. Copy the template block below under the playbook's heading.
2. Fill it in **before** opening `/admin`. The step outline is the step list; the asset list is the
   upload queue.
3. Author in `/admin` (see the click-path in `docs/SETUP.md`), publish, then come back and mark the
   date.
4. When a model swap breaks it, add a line to **Revision log** rather than editing the history.

Two rules that are easy to get wrong:

- **Both locales, always.** The publish RPC refuses a revision missing EN or KO on titles,
  summaries, step titles, step bodies, asset captions, link labels or a change note (§3.9). Prompts
  are *not* translated — they are model inputs; the KO explanation goes in a `note` block.
- **Showcase is revisioned and permanent-ish.** Marking a revision showcase copies its `public`
  blocks into the public bucket at publish, and anything ever served from there is permanently
  disclosed (§6 disclosure doctrine). Decide it here, not in the form.

---

## Template

```markdown
### {N}. {Playbook title EN} / {한국어 제목}

- **Slug**: `{lowercase-hyphenated}`
- **Category**: image | video | character | voice | music | pipeline
- **Difficulty**: beginner | intermediate | advanced
- **Showcase**: yes / no          ← public SEO surface; see the disclosure note above
- **Source pipeline**: where this actually lives — repo path, ComfyUI workflow file, Notion page,
  the machine it runs on. A future revision starts by re-reading this.
- **Models / tools**: the tag list, exactly as it should appear on the card
- **Est. time / cost**: minutes · USD

**Step outline**

| # | Step (EN / KO) | Blocks | Notes |
|---|---|---|---|
| 1 |  | prompt, params, asset | |
| 2 |  | | |

**Publish vs withhold**

| Prompt / parameter | Publish? | Reason |
|---|---|---|
|  | publish | |
|  | withhold (`hidden`) | client-identifying / licensed / not ours to give |

Default visibility is policy-driven (`prompt`/`params`/`workflow_file` → pro, `asset`/`note` → free,
`link` → public). Only list the **exceptions** here — anything you are deliberately holding back or
deliberately opening up.

**Assets + rights**

| File | Kind | Source | Rights | Cleared by |
|---|---|---|---|---|
|  | hero / asset / workflow_file | | own work / licensed / model output | |

**Copy owners**: EN {name} · KO {name}
**Target publish date**: YYYY-MM-DD
**Published**: —
**Revision log**: —
```

---

## Launch slate (§9)

Six playbooks, two of them showcase (§11 locked default #4). Cadence after launch: **2 new
playbooks/month minimum**, plus a revision pass whenever a model swap breaks one — the revisions are
the retention story, not a maintenance chore.

### 1. Character sheet generation / 캐릭터 시트 제작

- **Slug**: `character-sheet-generation`
- **Category**: character
- **Difficulty**: intermediate
- **Showcase**: **yes**
- **Source pipeline**: GPT Image 2 sheet generation + the face-fix pass (facefusion-service)
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

### 2. Talking character clip / 말하는 캐릭터 클립

- **Slug**: `talking-character-clip`
- **Category**: video
- **Difficulty**: intermediate
- **Showcase**: **yes**
- **Source pipeline**: image → voice → lipsync
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

### 3. Character LoRA training / 캐릭터 LoRA 학습

- **Slug**: `character-lora-training`
- **Category**: character
- **Difficulty**: advanced
- **Showcase**: no
- **Source pipeline**: Z-Image LoRA, the 22-minute recipe
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

### 4. Insta-toon pipeline / 인스타툰 파이프라인

- **Slug**: `insta-toon-pipeline`
- **Category**: image
- **Difficulty**: beginner
- **Showcase**: no
- **Source pipeline**: 4-cut story → panels → publish
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

### 5. AI short-form clip factory / AI 숏폼 클립 팩토리

- **Slug**: `short-form-clip-factory`
- **Category**: pipeline
- **Difficulty**: advanced
- **Showcase**: no
- **Source pipeline**: script → shots → assembly
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

### 6. Voice identity setup / 보이스 아이덴티티 설정

- **Slug**: `voice-identity-setup`
- **Category**: voice
- **Difficulty**: beginner
- **Showcase**: no
- **Source pipeline**: TTS selection + reference recording
- **Models / tools**: —
- **Est. time / cost**: —
- **Copy owners**: EN — · KO —
- **Target publish date**: —
- **Published**: —

---

## Fixture promotion

Slugs 1, 2, 4 and 6 are currently **fixtures** (`scripts/fixtures.ts`) with deterministic
placeholder media and greppable sentinel tokens. They exist so the acceptance suites and
`npm run sweep:anon` have something real to assert against; they are not content.

Promoting one means: author the real playbook in `/admin` under the same slug on a clean database,
and let the fixture keep living only in the local snapshot (`npm run db:local`). Do **not** edit a
fixture into a real playbook — the sentinels are load-bearing for the leak sweep, and a half-real
fixture would quietly weaken it.
