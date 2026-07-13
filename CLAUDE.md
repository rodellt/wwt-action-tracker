# Cox HPT Daily Stand-Up Tracker

A static webpage (GitHub Pages) that replaces the screen-shared Excel "Action Tracker"
for the Cox HPT daily stand-up. Claude Code updates it after every call from the
Teams transcript (.docx). The data is a single encrypted JSON file; the page decrypts
it in the browser with the team passphrase.

## Architecture

- `index.html` + `css/styles.css` + `js/app.js` — the site (no build step, no dependencies).
- `data/data.json` — **plaintext working copy** (gitignored — never commit).
- `data/data.enc.json` — AES-256-GCM encrypted envelope, **the only data file committed**.
- `.secrets/passphrase.txt` — team passphrase (gitignored). Same passphrase the team types into the page.
- `scripts/publish.mjs` — data.json → data.enc.json (encrypt).
- `scripts/sync.mjs` — data.enc.json → data.json (decrypt). Run after `git pull`.
- `scripts/extract-docx.mjs` — dumps transcript text: `node scripts/extract-docx.mjs "<path>.docx"`.
- `scripts/serve.mjs` — local preview server (port 8420).
- Web completions: the page itself can commit to `data/data.enc.json` via the GitHub
  Contents API using the user's fine-grained PAT (stored in their browser).
  So **always pull + sync before editing data.json.**

## THE DAILY WORKFLOW (when the user drops transcript path(s) in chat)

1. `git pull`
2. `node scripts/sync.mjs` — refresh `data/data.json` from the pulled encrypted file
   (this picks up items completed from the webpage since last time).
3. `node scripts/extract-docx.mjs "<transcript path>"` — get the text. Read ALL of it.
4. Update `data/data.json`:
   - **New meeting entry** at the top of `meetings[]` (keep sorted newest-first):
     date, title, durationMin, `advancedPurchase` one-liner, `risks` one-liner,
     `funFriday` (Fridays), `absent` map (only evidenced absences), and per-speaker
     `notes` — 1–4 concise bullets each, real content only (statuses, blockers,
     decisions, wins). Skip banter. "All set." is a valid note.
   - **Action items**: add new ones (`id` = `ai-YYYYMMDD-NN`, owner = single member id,
     imperative text, detail with context/names/dates, `created`, `source`, `status: "open"`).
   - **Verbal completions**: if a speaker says something is done ("that shipped",
     "we got the approval", "I sent it"), find the matching open item and set
     `status: "completed"`, `completed: { date, method: "verbal", by: "Claude (transcript)", note: "<evidence>" }`.
     Match by meaning, not exact words. When unsure, leave open and flag it to the user.
   - **advancedPurchase**: update stage notes + `lastVerified`/`lastVerifiedNote`
     whenever the call touches advance purchase status (IPC pipeline etc.).
   - **risks**: update `detail`/`lastUpdate`/`lastUpdateNote`; add/remove risks when
     the call says so (Kate owns this section on the call).
   - **pto**: add entries when someone announces PTO/OOO ("I'm out next week", "back
     on the 27th"). Resolve relative dates against the MEETING date, not today.
     Members: `bo` has no transcript name (never speaks); see `transcriptNames` for mapping.
   - Set top-level `lastUpdated` (publish.mjs also refreshes it automatically).
5. `node scripts/publish.mjs` — re-encrypt.
6. `git add data/data.enc.json && git commit` (message like `Stand-up 2026-07-14`),
   `git pull --rebase`, `git push`. If the rebase pulled in a new data.enc.json,
   redo steps 2–5 on top of it (rare).
7. Report to the user: new/completed action items, APO + risk changes, PTO changes,
   and anything ambiguous that needs their judgment.

## SCHEDULED DAILY RUN (weekdays 9:00 AM Central)

A local scheduled task ("hpt-daily-update") runs Claude Code every weekday at
9:00 AM Central (the stand-up ends ~8:30). That session should:

1. `node scripts/find-transcript.mjs` — lists transcripts in ~/Downloads (and any
   extra dirs passed) whose INTERNAL meeting date is newer than the last processed
   meeting. Run `git pull` + `node scripts/sync.mjs` first so the comparison is fresh.
2. If found: run THE DAILY WORKFLOW (below) for each, oldest first.
3. If none: re-check every ~5 minutes until 10:00 AM, then send a push
   notification asking Tyler to download the transcript (Teams → the meeting →
   Recap → download transcript .docx → Downloads folder) and stop. A no-meeting
   day (holiday) is normal — just say so in the notification.
4. Finish with a push notification summarizing: new/completed action items,
   APO/risk/PTO changes, and anything ambiguous.

Transcript supply: Tyler either downloads the .docx after the call (lands in
Downloads) or a Power Automate flow deposits it into a OneDrive-synced folder —
if such a folder exists, pass it to find-transcript.mjs as an extra dir.

## Conventions & gotchas

- Meeting date comes from the transcript header (`Cox HPT-YYYYMMDD_...` + "July 13, 2026" line),
  NOT from the docx file metadata (that's the download date).
- Teams mislabels spoken names ("Brian"/"Ron" = Ryan; "Mal"/"Mo"/"Now" = Mauricio;
  "Cheryl" = Sheryl Edwards). Trust the speaker labels (`Lastname, Firstname`) over
  spoken names, and `transcriptNames` in data.json for mapping.
- Two Johns: **Jon Hoey** (Account) and **John Lediaev** (Mat Ops). "John" items about
  quotes/deals/Cisco → Hoey; receiving/non-cons/warehouse → Lediaev.
- Call order: Advanced Purchase → Current Risks (Kate) → ISRs (Ryan, Chandra, Bo, Zach)
  → Buyers (Nick) → Planning (Mau, Andrea) → Mat Ops (John L, Rob, AJ) → Account
  (Sheryl, Davis, Jon H) → PM (Kate, Jessie) → CSEs (Jim, Arno) → Extended (Mickey,
  Tori, Theresa, Jackson). Tyler facilitates.
- Assign each action item to exactly one owner (the person who said they'd do it, or
  who it was handed to). Joint work: pick the primary, name the others in `detail`.
- Do not commit transcripts, the Excel file, `data/data.json`, or `.secrets/`.
- Passphrase lives in `.secrets/passphrase.txt`. Never print it into committed files.
- The site is public at https://rodellt.github.io/wwt-action-tracker/ — the repo is
  public, only the encrypted blob is exposed. Keep every meeting detail inside
  `data/data.json` → encrypted envelope, never in committed HTML/JS/README.

## Verifying changes

`node scripts/serve.mjs` then open http://localhost:8420 (passphrase from .secrets).
Or use the `tracker` entry in `.claude/launch.json`.
