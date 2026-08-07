# Cox HPT Stand-Up Tracker — Handoff Guide

> ## Successor's quickstart (updated for v3, August 2026)
>
> The whole takeover is ~20 minutes at a keyboard plus a morning of watching it
> run. Work top to bottom; details in the full guide below. **Easiest path:
> open this repo folder in Claude Code and ask it to walk you through this
> checklist.**
>
> **Before you start you need:** the Claude desktop app with Claude Code (your
> seat needs cloud routines + the Microsoft 365 connector); git + Node 18+;
> membership in the Teams team "Cox Communications Program Information"; an
> invite on the daily "Cox HPT" meeting; and Tyler (or the current owner) on
> the phone to tell you the team passphrase (it is deliberately written
> nowhere).
>
> 1. **Get the code**: clone the repo (current home: Tyler's enterprise GitHub,
>    `rodellt_wwthc/wwt-action-tracker` — private, code-only). If you can't
>    reach it, any owner machine's working folder is a complete copy — the repo
>    holds no data, so even a zip of the folder works.
> 2. **Passphrase**: create `.secrets/passphrase.txt` (one line) in your clone.
> 3. **Sync the team folder**: in Teams → "Cox Communications Program
>    Information" → General → Documents › General › Daily HPT Meeting › Action
>    Tracker → Sync (OneDrive). Note your local synced path and update
>    `DEFAULT_TEAM_FILE` in `scripts/pull-dist.mjs` + the copy path in
>    CLAUDE.md if it differs from Tyler's.
> 4. **Prove it works**: `node scripts/pull-dist.mjs` then
>    `node scripts/sync.mjs` — should print "Decrypted …".
> 5. **Take over Send-sync mail**: update `CONFIG.syncEmail` in `js/app.js` to
>    YOUR address, rebuild (`node scripts/publish.mjs` +
>    `node scripts/build-html.mjs`), and copy the new file into the synced
>    folder. Team edit emails now come to you.
> 6. **Connector**: connect Microsoft 365 (claude.ai/customize/connectors and
>    the desktop app) under YOUR account — read/calendar for transcripts,
>    SharePoint for the file.
> 7. **Automation**: ask Claude Code — *"Recreate the daily cloud routine and
>    the local fallback task per CLAUDE.md's SCHEDULED DAILY RUN section."*
>    (The routine's instructions include the passphrase — expected; that's how
>    the cloud run decrypts.) Run the routine once manually; expect a green
>    report and a fresh `HPT-Tracker.html` in the folder.
> 8. **Decommission the old owner** (them, after a green morning): delete their
>    routine + local task, disconnect their connector, delete their `.secrets`,
>    and rotate the passphrase if it ever traveled beyond the team.

**The tracker the team uses:** `HPT-Tracker.html` in Teams →
"Cox Communications Program Information" → Documents › General › Daily HPT
Meeting › Action Tracker. **Code repo:** private enterprise GitHub (code only —
no data ever).

## 1. What this is

One self-contained HTML file that replaced the screen-shared Excel. It shows
per-person action items and notes, the (team-owned, movable) Advanced Purchase
card, current risks, and PTO. Every weekday at ~9:15 AM Central a Claude cloud
routine pulls the day's Teams transcript, applies the team's queued edits
(HPT-SYNC emails), updates the data, and refreshes the file in the folder.
Team members open their synced copy, unlock with the team passphrase, and can
complete/edit/add anything — edits queue inside the page and travel by the
"📤 Send sync" email button.

Security model: all meeting content lives in ONE AES-256-GCM envelope embedded
in the file; the passphrase never leaves people's heads/browsers. The file
lives only inside WWT's SharePoint. GitHub holds code only. There are no
tokens, no public site, and the page makes zero network calls.

## 2. Component inventory

| Component | Where it lives | Anchored to | Fails when |
|---|---|---|---|
| The tracker file (app + data) | Teams/SharePoint folder above | The team site | Someone deletes it (SharePoint version history restores it) |
| Data truth | The envelope inside that file | The team passphrase | Passphrase lost = data cryptographically gone (§4) |
| Code repo | Enterprise GitHub, private | Owner's enterprise account | Any clone is a full backup |
| Cloud routine "HPT daily stand-up update" (14:15 UTC weekdays) | claude.ai/code/routines | Owner's Claude seat + passphrase in instructions | Seat deactivated → updates stop |
| M365 connector | claude.ai/customize/connectors | Owner's WWT identity | Needs re-auth every few weeks (§4) |
| Local fallback task "hpt-daily-update" (~9:45 CT) | Owner's laptop, Claude desktop app | Laptop + clone + `.secrets` | Laptop off (it's only a backstop) |
| Send-sync mailbox | `CONFIG.syncEmail` in js/app.js | Owner's mailbox | Change it when ownership changes (quickstart step 5) |
| The meeting + transcription | Teams, Kate Mentzer, 8:00–8:30 CT | Kate | Transcription must stay on |

## 3. Day to day (owner's duties: usually nothing)

- **8:00–8:30 CT** — the call. Facilitator opens the tracker → ▶ Present →
  screen-shares; items get checked off live as people report.
- **~9:15 CT** — cloud routine updates the file (transcript + queued edits +
  automatic retention pruning: 14 days of meetings, completed items drop 2
  business days after completion).
- **~9:45 CT** — local fallback checks and exits silently if done.
- Team members re-open / re-copy the fresh file per the Work Instruction doc in
  the same folder.
- Recurring duties: reconnect the M365 connector when a run reports it
  disconnected; forward-looking judgment calls flagged in the daily report.

## 4. Things the new owner must know

- **The passphrase is the crown jewel.** Rotate with
  `node scripts/rotate-passphrase.mjs <new>` (then rebuild + ship the file,
  update the routine's instructions, tell the team). If it's lost and no
  machine has a decrypted `data/data.json`, the data is gone.
- **The M365 connector disconnects periodically** (corporate token policy).
  Symptom: the run reports it can't reach transcripts/SharePoint. Fix:
  reconnect. The next run catches up automatically.
- **The Advanced Purchase card is team-owned.** The daily update never touches
  it; the team edits (✎) and parks (⠿ Move) it themselves. Don't "fix" it in
  data updates.
- **Retention is automatic** (publish.mjs). Don't hand-prune, and don't be
  surprised that meetings older than 14 days and old completed items vanish.
- **Encoding hazard:** never edit `index.html`/`css`/`js` with PowerShell
  `-replace` — it mangles UTF-8. Claude's Edit tool only.
- **The cloud cron is fixed UTC (14:15)** — fires an hour earlier relative to
  Central after the November time change; it polls for the transcript, so it
  still lands.
- **Conventions live in CLAUDE.md** — speaker-label gotchas, the two Johns, id
  spaces, ops format. Any Claude Code session in the repo reads it
  automatically; it is the project's durable brain.
- **The old public GitHub setup (Pages site, edit key, PATs) is retired.** If
  you find references to it anywhere, they're stale — nothing in the system
  talks to GitHub anymore except developers pushing code.

## 5. People

- **Kate Mentzer** — meeting organizer, owns risks on the call, runs
  transcription; natural escalation if transcripts stop appearing.
- **The team** — needs nothing for a handoff except knowing edits queue while
  ownership moves (Send-sync mail goes to the new owner after step 5).
