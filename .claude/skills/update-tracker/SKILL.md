---
name: update-tracker
description: Process one or more daily stand-up transcripts (.docx or M365 connector) and update the Cox HPT tracker — notes, action items, verbal completions, risks, and PTO — then publish, rebuild, and ship the team file. Never touches the Advanced Purchase card; never commits data to git.
---

Follow the "THE DAILY WORKFLOW" section of CLAUDE.md in the repo root, step by step:

1. `node scripts/pull-dist.mjs` (team file's embedded envelope → data/data.enc.json),
   then `node scripts/sync.mjs` to decrypt into data/data.json.
2. Apply queued team edits FIRST: `HPT-SYNC` emails from the last ~4 days
   (op format and appliedOps ledger per CLAUDE.md's SYNC OPS section).
3. Extract each provided transcript with `node scripts/extract-docx.mjs "<path>"`
   (oldest meeting first if several) — or pull it via the Microsoft 365
   connector — and read the FULL text.
4. Update `data/data.json`: new meeting entry (per-speaker notes, absences),
   new action items, verbal completions (match by meaning; when unsure leave
   open and flag), risks, pto. Respect the conventions in CLAUDE.md
   (speaker-label trust, the two Johns, dates from the transcript header).
   ⚠ NEVER create, update, or remove anything under `advancedPurchase` from a
   transcript — that card is team-owned (web `aps-edit` ops are the only path;
   the one-line advancedPurchase summary inside the meeting record is fine).
5. `node scripts/publish.mjs` (auto-prunes retention: completed items 2
   business days, meetings 14 days) then `node scripts/build-html.mjs`.
6. Ship it: copy `dist/HPT-Tracker.html` over the team file in the
   OneDrive-synced folder (exact path + connector fallback in CLAUDE.md).
   Git: nothing — data changes are never committed.
7. Report: sync ops applied, new/completed items, risk/PTO changes, retention
   prunes, ship status, and anything ambiguous.

If no transcript path was given: first try the Microsoft 365 connector
(calendar event → `meetingTranscriptUrl` → WebVTT — see CLAUDE.md "SCHEDULED
DAILY RUN"), then `node scripts/find-transcript.mjs` for ~/Downloads.
Ask Tyler only if both come up empty.
