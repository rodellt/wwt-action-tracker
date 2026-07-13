---
name: update-tracker
description: Process one or more daily stand-up transcripts (.docx) and update the Cox HPT tracker site — notes, action items, verbal completions, advanced purchase status, risks, and PTO — then encrypt, commit, and push.
---

Follow the "THE DAILY WORKFLOW" section of CLAUDE.md in the repo root, step by step:

1. `git pull`, then `node scripts/sync.mjs`.
2. Extract each provided transcript with `node scripts/extract-docx.mjs "<path>"`
   (oldest meeting first if several) and read the full text.
3. Update `data/data.json`: new meeting entry (per-speaker notes, absences),
   new action items, verbal completions (match by meaning; when unsure leave open
   and flag), advancedPurchase, risks, pto. Respect the conventions in CLAUDE.md
   (speaker-label trust, the two Johns, dates from the transcript header).
4. `node scripts/publish.mjs`, commit `data/data.enc.json`
   (`Stand-up YYYY-MM-DD`), `git pull --rebase`, `git push`.
5. Report: new items, completed items, APO/risk/PTO changes, ambiguities.

If no transcript path was given, ask for it (or check ~/Downloads for a new
`Cox HPT*.docx` newer than the last processed meeting and confirm before using it).
