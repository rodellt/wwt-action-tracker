# Cox HPT Daily Stand-Up Tracker

The team's daily stand-up tracker (replaced the screen-shared Excel). Since v3
it is **SharePoint-native**: the tracker ships as ONE self-contained file,
`HPT-Tracker.html`, living in the team's Teams/SharePoint folder. Claude Code
updates it after every call from the Teams transcript. **GitHub stores code
only** — no data, no tokens, no Pages site, and the page itself never talks to
GitHub.

## Architecture (v3)

- `index.html` + `css/styles.css` + `js/app.js` — the app source (no build deps).
- `dist/HPT-Tracker.html` — the built artifact and THE tracker: source files
  inlined + the AES-256-GCM encrypted data envelope embedded. The team's copy
  lives in the OneDrive-synced folder
  `C:\Users\rodellt\WWT\Cox Communications Program Information - Action Tracker\`
  which syncs to Teams team **"Cox Communications Program Information"** →
  Documents › General › Daily HPT Meeting › Action Tracker.
  **That file's embedded envelope is the source of truth for data.**
- `data/data.json` (plaintext) and `data/data.enc.json` (encrypted) — LOCAL
  working files only; both gitignored, never committed.
- `.secrets/passphrase.txt` — team passphrase (gitignored). Same passphrase the
  team types into the page.
- Scripts (`node scripts/<name>.mjs`):
  - `pull-dist.mjs` — team file's embedded envelope → `data/data.enc.json`.
    **Run FIRST in any data-editing session** (refuses to go backwards in time).
  - `sync.mjs` — `data.enc.json` → `data.json` (decrypt).
  - `publish.mjs` — `data.json` → `data.enc.json` (encrypt). Also enforces
    retention automatically: meetings older than 14 days and completed items
    more than 2 business days old are pruned on every publish.
  - `build-html.mjs` — rebuilds `dist/HPT-Tracker.html` from source + envelope.
  - `extract-docx.mjs "<path>.docx"` — dump transcript text.
  - `find-transcript.mjs` — newer-than-last-processed transcripts in Downloads.
  - `rotate-passphrase.mjs <new>` — re-encrypt under a new passphrase.
  - `serve.mjs` — local preview server (also `tracker` in `.claude/launch.json`).
- Web edits (complete/reopen/edit/add items, risks, APS) apply on-device and
  queue as ops inside the page; "📤 Send sync" emails them to the owner —
  see SYNC OPS below. There is no other write path.

## THE DAILY WORKFLOW (when the user drops transcript path(s) in chat, or a scheduled run fires)

1. `node scripts/pull-dist.mjs` — refresh the local envelope from the team's
   synced file (picks up everything since the last run).
2. `node scripts/sync.mjs` — decrypt to `data/data.json`.
3. **Apply queued team edits**: search the owner's mailbox for `HPT-SYNC`
   emails (last ~4 days) and apply their ops FIRST — see SYNC OPS.
4. Get the transcript text (connector or `extract-docx.mjs`) and read ALL of it.
5. Update `data/data.json`:
   - **New meeting entry** at the top of `meetings[]` (keep sorted newest-first):
     date, title, durationMin, `risks` one-liner, `funFriday` (Fridays),
     `absent` map (only evidenced absences), and per-speaker `notes` — 1–4
     concise bullets each, real content only. "All set." is a valid note.
   - **Action items**: add new ones (`id` = `ai-YYYYMMDD-NN`, owner = single
     member id, imperative text, detail with context/names/dates, `created`,
     `source`, `status: "open"`).
   - **Verbal completions**: if a speaker says something is done, set
     `status: "completed"`, `completed: { date, method: "verbal", by: "Claude (transcript)", note: "<evidence>" }`.
     Match by meaning. When unsure, leave open and flag it to the user.
   - **⚠ Advanced Purchase Status is TEAM-OWNED: never create, update, move, or
     remove anything under `advancedPurchase`** — the team edits it on the page
     (✎ Edit) and parks the card where they want it (⠿ Move). Ops of kind
     `aps-edit` from the team still get applied (that IS the team editing).
   - **risks**: update `detail`/`lastUpdate`/`lastUpdateNote`; add/remove risks
     when the call says so (Kate owns this section on the call).
   - **pto**: add entries when someone announces PTO/OOO. Resolve relative
     dates against the MEETING date, not today.
   - Retention is automatic — do not hand-prune; `publish.mjs` does it.
6. `node scripts/publish.mjs` — prune + re-encrypt.
7. `node scripts/build-html.mjs` — rebuild the single file.
8. **Ship it**: copy `dist/HPT-Tracker.html` over the team file:
   `Copy-Item "<repo>\dist\HPT-Tracker.html" "C:\Users\rodellt\WWT\Cox Communications Program Information - Action Tracker\HPT-Tracker.html" -Force`
   (OneDrive uploads it to the Teams folder automatically. If the synced folder
   is missing, fall back to the M365 connector: `sharepoint_update_file` on
   that file — find it via `sharepoint_search "HPT-Tracker"`.)
9. **Git: nothing.** Data changes are never committed. Commit and push only
   when CODE/docs changed in the same session.
10. Report to the user: sync ops applied, new/completed action items, risk
    changes, PTO changes, upload status, and anything ambiguous.

## SCHEDULED DAILY RUN

Two layers, same outcome (the tracker file is updated by ~9:15–9:20 AM Central):

1. **Cloud routine (primary):** "HPT daily stand-up update"
   (claude.ai/code/routines, id trig_01Q51z47mWpFnjRSpNVnytzV) runs weekdays at
   **14:15 UTC** (9:15 AM Central in summer; fires 8:15 AM Central after the
   November time change — it polls for the transcript, so it still lands, just
   earlier). It is **git-free**: it reads the team file via the M365 connector,
   extracts the embedded envelope, decrypts with the passphrase in its own
   instructions, applies HPT-SYNC ops + the day's transcript, re-encrypts,
   swaps the envelope inside the same HTML (replace the
   `window.__HPT_EMBEDDED = {...};` payload and the `window.__HPT_BUILD`
   stamp), and uploads via `sharepoint_update_file`. It never needs GitHub.
2. **Local fallback:** desktop scheduled task "hpt-daily-update", weekdays
   ~9:45 AM Central. Exits silently if the team file's data is already
   today's; otherwise runs THE DAILY WORKFLOW above (transcript via connector,
   Downloads as backup) and ships by file copy.

Catch-up: process missed weekdays oldest → newest; never re-process a date
already in `meetings[]`. No "Cox HPT" calendar event = holiday, just say so.
Wednesdays often have no meeting. Finish every run with a push notification:
sync ops applied, new/completed action items, risk/PTO changes, ambiguities.

## SYNC OPS (team edits from the distributed file)

Edits made in the page queue as ops and arrive as emails to the owner's mailbox
(`CONFIG.syncEmail` in js/app.js) with subject `HPT-SYNC` and a body containing
`HPT-OPS:<base64 JSON array>:END`. Every daily run applies these FIRST:

- op = `{id, ts, by, kind, ...}`; apply unless `id` is already in
  `data.appliedOps`; afterwards append the id to `data.appliedOps`
  (keep newest ~200). Never write `_pending`/`_op` fields into data.json.
- kinds: `complete` {itemId, note?} → status completed, completed{date: op
  date, method "manual", by, note} (skip if missing/already done) ·
  `reopen` {itemId} · `item-edit` {itemId, text, detail, owner} ·
  `item-add` {owner, text, detail?} → new `ai-YYYYMMDD-wNN`, source
  "web — <by>" · `item-delete` {itemId} · `risk-edit`/`risk-add`/`risk-delete` ·
  `aps-edit` {stages, footnote} → replace stages, stamp lastVerified (this is
  the ONLY way advancedPurchase changes).

## Conventions & gotchas

- Meeting date comes from the transcript header/event date, NOT the docx file
  metadata (that's the download date).
- Teams mislabels spoken names ("Brian"/"Ron" = Ryan; "Mal"/"Mo"/"Now" =
  Mauricio; "Cheryl" = Sheryl Edwards). Trust speaker labels
  (`Lastname, Firstname`) and `transcriptNames` in data.json.
- Two Johns: **Jon Hoey** (Account) and **John Lediaev** (Mat Ops). Quotes/
  deals/Cisco → Hoey; receiving/non-cons/warehouse → Lediaev.
- Call order: Advanced Purchase → Current Risks (Kate) → ISRs (Ryan, Chandra,
  Bo, Zach) → Buyers (Nick) → Planning (Mau, Andrea) → Mat Ops (John L, Rob,
  AJ) → Account (Sheryl, Davis, Jon H) → PM (Kate, Jessie) → CSEs (Jim, Arno)
  → Extended (Mickey, Tori, Theresa, Jackson). Tyler facilitates.
- One owner per action item; joint work: pick the primary, name others in
  `detail`. Web-created ids `ai-YYYYMMDD-wNN` — never renumber; transcript
  items use the separate `ai-YYYYMMDD-NN` space.
- Completed items stay visible inline until the next day's call is processed,
  fold after that, and disappear 2 business days after completion (display
  filter + publish-time pruning). Meetings keep a 14-day history. Both are
  automatic.
- Always give new risks an `id` slug (`risk-...`) — web edits find risks by id.
- **Encoding hazard:** never rewrite `index.html`/`css`/`js` with PowerShell
  `-replace`/`Set-Content` — it has corrupted UTF-8 twice. Use Claude's
  Edit/Write tools for source files.
- Do not commit transcripts, the Excel file, `data/` contents, `dist/`, or
  `.secrets/`. The repo is code + docs only.
- Never print the passphrase into committed files or logs.
- Repo home: being migrated from github.com/rodellt/wwt-action-tracker
  (personal, public — retiring) to Tyler's enterprise account
  (`rodellt_wwthc`), private, code-only. Update this line when done.

## Verifying changes

`node scripts/serve.mjs` then open http://localhost:3000 — or preview the
built file at `/dist/HPT-Tracker.html` (that's what the team actually uses).
Passphrase from `.secrets`. Verify VISUALLY (computed styles / screenshots),
not just DOM state.
