# Cox HPT Stand-Up Tracker — Handoff Guide

> ## Kate's quickstart (handoff of July 2026)
>
> Kate — this whole takeover is about 30 minutes at a keyboard, ideally with
> Tyler on a call for the first ten. Work top to bottom; every step is expanded
> in the full guide below. **Easiest path: open this repo folder in Claude Code
> and ask it to walk you through this checklist — it can do most steps for you.**
>
> **Before you start you need:** a GitHub account (free — github.com/signup);
> the Claude desktop app with Claude Code (your seat needs cloud routines + the
> Microsoft 365 connector — check with IT/Tyler if unsure); git + Node 18+
> installed; and Tyler on the phone to tell you the team passphrase (it is
> deliberately written nowhere).
>
> **On GitHub (your account):**
> 1. Copy the repository to your account (no transfer needed — it's public):
>    go to **github.com/new/import**, paste the source URL
>    `https://github.com/rodellt/wwt-action-tracker`, set owner = you, name =
>    `wwt-action-tracker`, visibility Public → Begin import. A few minutes later
>    the full project with its history lives at
>    `github.com/<your-username>/wwt-action-tracker`, entirely yours.
>    ⚠ Timing: do this AFTER the morning's ~9:08 auto-update, and finish the
>    whole checklist the same sitting — edits made on the OLD page after this
>    copy won't carry over, so the team should hold edits until you send the
>    new URL.
> 2. Re-enable the website: repo → Settings → Pages → Source "Deploy from a
>    branch" → branch `main`, folder `/ (root)` → Save. (Pages settings don't
>    survive a transfer.) The team's new URL becomes
>    `https://<your-username>.github.io/wwt-action-tracker/`.
> 3. Create your edit token: github.com/settings/personal-access-tokens/new →
>    name `hpt-tracker-edit-key`, Expiration: custom ~1 year, Repository access:
>    "Only select repositories" → `wwt-action-tracker`, Permissions → Contents:
>    **Read and write** (nothing else). Generate, copy — you'll paste it in step 7.
>
> **On your machine:**
> 4. `git clone https://github.com/<your-username>/wwt-action-tracker` and open
>    the folder in Claude Code.
> 5. Make a `.secrets` folder in it; put the passphrase Tyler gives you (one
>    line) in `.secrets/passphrase.txt`.
> 6. Prove it works: `node scripts/sync.mjs` → should print "Decrypted …".
> 7. Point the site at your account: ask Claude Code — *"the repo now lives
>    under `<your-username>` — update CONFIG.owner AND CONFIG.syncEmail (my
>    WWT email — team sync mails go there) in js/app.js, sweep the old owner
>    from the docs, bump the cache-busters, commit and push."*
> 8. Publish your edit token: `node scripts/publish-edit-key.mjs` → paste the
>    token from step 3. Team editing now runs on your credential.
>
> **On Claude:**
> 9. Connect the Microsoft 365 connector (sign in with your WWT account) at
>    claude.ai/customize/connectors — this is how the daily transcript is read
>    (read-only).
> 10. Ask Claude Code: *"Recreate the daily cloud routine and the local fallback
>     task for this tracker per CLAUDE.md's SCHEDULED DAILY RUN section."* Run
>     the routine once manually to see a green report.
>
> **Finish:** send the team the new page URL (same passphrase — they'll type it
> once per device); watch one full morning cycle (8:00 call → ~9:08 auto-update);
> then tell Tyler so he can decommission his credentials (checklist in §4,
> Phase 3 below).

This is the complete handoff package: what the system is, every component and the
account it's tied to, how it runs day to day, and a phased plan for transferring
ownership without the team noticing a bump. The takeover itself is ~30 minutes of
work plus a couple of days of watching it run.

**Live page:** https://rodellt.github.io/wwt-action-tracker/
**Repo:** https://github.com/rodellt/wwt-action-tracker

> **Since v2.0 the team's copy is a FILE, not a URL:** every morning the
> routine rebuilds `HPT-Tracker.html` (self-contained, encrypted snapshot
> embedded) and uploads it to Teams — team **"Cox Communications Program
> Information"** → General channel → **Documents › General › Daily HPT
> Meeting › Action Tracker** (next to the old Excel) — since GitHub Enterprise
> blocks github.io for users. Team members Sync that folder via OneDrive and
> open the file from a shortcut; their edits queue inside the file and come
> back as `HPT-SYNC` emails to the owner's mailbox (`CONFIG.syncEmail` in
> js/app.js), applied automatically at the next run. GitHub Pages still works
> as the owner's live view.

## 1. What this is

The team's daily stand-up tracker — it replaced the screen-shared Excel "Action
Tracker." A static webpage (GitHub Pages) shows per-person action items and notes,
advanced purchase status, current risks, and PTO. Every weekday after the 8:00 AM
Central call, a Claude cloud routine pulls the Teams transcript, extracts
notes/action items/completions/risks/PTO, and commits the update; the page reflects
it a minute later. The team can also complete/edit/add anything directly on the
page (including in presentation mode, which the facilitator screen-shares during
the call).

Security model: the repo and page are public, but all meeting content lives in ONE
AES-256-encrypted file (`data/data.enc.json`). Viewers type the team passphrase
once per device. Page edits commit via a shared "edit key"
(`data/edit-key.enc.json` — a GitHub token, itself encrypted with the same
passphrase). Nothing sensitive is ever committed in plaintext: no transcripts, no
passphrase, no tokens, no plaintext data.

## 2. Component inventory — and what each is anchored to

| Component | Where it lives | Anchored to | Fails when |
|---|---|---|---|
| Live page (GitHub Pages) | rodellt.github.io/wwt-action-tracker | Repo location | Repo moves (URL changes — see §4 Phase 1) |
| Repo + git history | github.com/rodellt/wwt-action-tracker | Tyler's personal GitHub | Only if that account is deleted |
| Encrypted data + edit key | `data/*.enc.json` in the repo | The team passphrase | Passphrase lost (unrecoverable — see §5) |
| Team passphrase | People's heads + each owner's local `.secrets/passphrase.txt` | — | Must be handed over person-to-person; it is written nowhere in the repo |
| Shared edit key (page editing) | `data/edit-key.enc.json` | Tyler's GitHub fine-grained PAT (created Jul 2026, ~1yr expiry) | PAT expires/revoked → page edits fail ("edit key was rejected") |
| Cloud routine "HPT daily stand-up update" | claude.ai/code/routines (id `trig_01Q51z47mWpFnjRSpNVnytzV`), weekdays 14:00 UTC | Tyler's Claude account + the passphrase in its instructions | His seat is deactivated → daily updates stop |
| Microsoft 365 connector (transcript access) | claude.ai/customize/connectors | Tyler's WWT Microsoft identity | His account closes, or token needs re-auth (happens every few days/weeks — see §5) |
| Local fallback task "hpt-daily-update" | Claude desktop app on Tyler's laptop, weekdays ~9:45 CT | Tyler's laptop + local clone + `.secrets` | Laptop off (it's only a backstop) |
| The meeting + transcription | Teams, organized by Katelyn.Mentzer@wwt.com, 8:00–8:30 CT | Kate | Kate must keep transcription on; successor must be an invitee |
| Docs & workflow brain | `CLAUDE.md` (pipeline), `ONBOARDING.md` (this), `README.md` | The repo | Travels with it — nothing to transfer |

Everything in the "anchored to Tyler" rows must be re-anchored during handoff.
Everything else transfers automatically with the repo.

## 3. How it runs day to day (what the new owner actually does: usually nothing)

- **8:00–8:30 AM CT** — the stand-up. Facilitator opens the live page → ▶ Present
  → screen-shares; items get completed/edited live as people report.
- **9:08 AM CT** (14:00 UTC — an hour earlier relative to Central in winter) — the
  cloud routine runs: syncs, pulls that day's transcript via the M365 connector
  (retries while the transcript finishes processing), updates data, pushes. Its
  report appears on the routines page. If days were missed, it catches up oldest
  → newest automatically; no calendar event = holiday = skipped.
- **~9:45 AM CT** — the local fallback task checks whether the day is processed
  and exits silently if so; it only acts (and notifies) if the cloud run failed
  and the laptop is on.
- **Anytime** — team members with the passphrase view/edit from any network, no
  VPN, no accounts.
- The owner's only recurring duties: reconnect the M365 connector when a run
  reports it's disconnected, refresh the edit key when it nears expiry, and hand
  ambiguities flagged in the daily report to the right person on the call.

## 4. The handoff plan (phased — nothing gets torn down until the new setup is proven)

### Phase 0 — Prep (before transfer day)
- Successor needs: a Claude seat with Claude Code (with cloud routines and the
  Microsoft 365 connector available), a GitHub account, Node 18+ and git locally,
  and an invite on the daily "Cox HPT" meeting.
- Decide the repo's destination. Two options:
  - **Transfer to the successor / a team GitHub org (recommended)** — clean break.
    ⚠ The Pages URL changes with the owner (e.g. `neworg.github.io/wwt-action-tracker/`),
    so this requires the three-step follow-up in Phase 1 and a new link for the team.
  - **Add successor as admin collaborator, keep repo where it is** — zero URL
    disruption, but the project stays parked on the old owner's personal account.
    Acceptable short-term; plan the move eventually.

### Phase 1 — Transfer day (~30 minutes, do it together)
1. **Passphrase**: hand it over directly (call/chat — never commit it, never put
   it in a ticket). Successor creates `.secrets/passphrase.txt` in their clone and
   proves it with `node scripts/sync.mjs`.
2. **Repo**: transfer (GitHub → Settings → General → Transfer ownership) or add
   admin. If transferred: re-enable Pages (Settings → Pages → branch `main`,
   root), update `CONFIG.owner` at the top of `js/app.js` (and bump the two
   `?v=` cache-busters in `index.html`), commit, push, and send the team the new
   URL. Git remotes and API calls to the old name auto-redirect for a while; the
   old `*.github.io` URL does not — update bookmarks.
3. **Edit key**: successor creates their own fine-grained PAT (this repo only,
   Contents: Read & write, ~1 yr) and runs `node scripts/publish-edit-key.mjs`.
   Page editing now runs on their token.
4. **Connector**: successor connects Microsoft 365 at claude.ai/customize/connectors
   (and in the desktop app) under THEIR account.
5. **Automation**: successor opens Claude Code in their clone and says:
   *"Recreate the daily cloud routine and local fallback task for this tracker per
   CLAUDE.md's SCHEDULED DAILY RUN section."* Claude rebuilds both under their
   accounts (the routine needs the passphrase in its instructions — that's
   expected and consented; it's how the cloud run decrypts/re-encrypts).

### Phase 2 — Verification (run in parallel 1–2 days)
- Old routine stays enabled as backup; the duplicate-day guard ("already
  processed — nothing to do") makes double-running harmless.
- Confirm: successor's routine posts a green run report; the live page updates by
  ~9:15 CT; a page edit commits under the new key; presentation mode works on
  their machine.

### Phase 3 — Decommission (old owner, after verification)
- [ ] If the repo was COPIED rather than transferred: unpublish the old Pages
      site (old repo → Settings → Pages → unpublish deployment) and archive the
      old repo (Settings → General → Archive) so the stale page and stray edits
      die immediately; delete it entirely once the successor's copy has run
      green for a week.
- [ ] Revoke the old fine-grained PAT on GitHub (page edits should still work —
      they're on the successor's key now; if they break, re-run step 3).
- [ ] Delete the old cloud routine (claude.ai/code/routines) and the local
      scheduled task; uninstall/sign out as needed.
- [ ] Disconnect the old Microsoft 365 connector.
- [ ] Delete the local clone including `.secrets/` (or at least `.secrets/`).
- [ ] Optional but wise if the passphrase was ever shared beyond the team: rotate
      it (§5) so departed-owner knowledge ages out.

## 5. Things the new owner must know (learned the hard way)

- **The passphrase is the crown jewel.** It grants read AND edit (via the edit
  key). It's in no file that's committed. To rotate it: `git pull` +
  `node scripts/sync.mjs`, then `node scripts/rotate-passphrase.mjs <new>` (it
  re-encrypts the data AND the edit key in one pass), commit/push the two
  `data/*.enc.json` files, update the passphrase line in the cloud routine's
  instructions (claude.ai/code/routines), and tell the team — everyone re-enters
  it once. If it's ever *lost* and no
  machine still has a decrypted `data/data.json`, the data is cryptographically
  gone — keep one owner machine with a working `.secrets`.
- **The M365 connector disconnects every so often** (corporate token policy — it
  happened twice in the tracker's first week, and one stand-up went unprocessed
  overnight because of it). Symptom: the daily run reports it can't reach
  transcripts. Fix: reconnect at claude.ai/customize/connectors. The next run
  catches up missed days automatically.
- **The edit key expires** (fine-grained PATs max out around a year). The page
  footer shows a live countdown ("edit key renews in Nd" — amber under 30 days,
  red under 7) and Settings shows the exact date; `publish-edit-key.mjs` records
  the expiry each time a key is published. Fix when it's close: new PAT →
  `node scripts/publish-edit-key.mjs`. (A no-expiry machine-account token makes
  the countdown unnecessary — the page then shows nothing to renew.)
- **The cloud cron is fixed UTC** (14:00). After the November time change it
  fires at 8:08 AM Central — during the call — but it polls for the transcript,
  so it still lands. Shift the cron an hour if the early report bothers anyone.
- **Conventions live in CLAUDE.md** — transcript speaker-label gotchas (Teams
  mislabels names; there are two Johns), action-item id spaces
  (`ai-YYYYMMDD-NN` = pipeline, `-wNN` = web-created; never renumber), completed
  items staying visible until the next call is processed, risk id slugs. Any
  Claude Code session in the repo reads it automatically — it is the project's
  durable brain. (Claude's per-machine "memory" does NOT transfer; CLAUDE.md is
  what matters.)
- **Public repo discipline**: never commit transcripts (any format), the Excel
  file, `data/data.json`, or `.secrets/` — the `.gitignore` enforces this; don't
  fight it. Meeting content belongs ONLY inside the encrypted blob.
- **The old Excel "AM.PM Action Tracker" registry** (long-running
  issues/decisions log) was never ported — the tracker's Risks card carries the
  active items. The historical registry stays in the Excel file if anyone asks.
- **Page footer shows the app version** — if a user reports something odd, first
  ask what version their footer shows; a hard refresh (Ctrl+F5) cures stale
  caches.

## 6. People

- **Kate Mentzer** — meeting organizer, owns the risks section on the call, and
  runs transcription. If the successor changes, she should know (she's also the
  natural escalation if transcripts stop appearing).
- **The team** — needs nothing for the handoff except (possibly) a new page URL
  if the repo moves. Their passphrase and habits don't change.

## 7. Successor's 30-minute checklist

- [ ] Get the passphrase (verbally) and an invite to the daily meeting
- [ ] Clone the repo; create `.secrets/passphrase.txt`; `node scripts/sync.mjs` decrypts cleanly
- [ ] Repo transferred to me / I'm admin (if transferred: Pages re-enabled,
      `CONFIG.owner` updated, team has the new URL)
- [ ] My fine-grained PAT created; `node scripts/publish-edit-key.mjs` run
- [ ] My Microsoft 365 connector connected (claude.ai + desktop app)
- [ ] Cloud routine + local fallback recreated under my accounts (ask Claude Code)
- [ ] Watched one full green morning cycle (call → 9:08 run → page updated)
- [ ] Old owner completed Phase 3 decommission
