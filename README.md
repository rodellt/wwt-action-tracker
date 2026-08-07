# Cox HPT — Daily Stand-Up Tracker

A self-contained, encrypted stand-up tracker for a daily team call: per-person
action items and notes, a movable advanced-purchase status card, current risks,
and PTO/OOO — updated every weekday morning from the meeting transcript by a
scheduled Claude Code run.

**This repo holds code only.** The tracker itself ships as one built file
(`dist/HPT-Tracker.html`) living in the team's SharePoint/Teams folder, with
the AES-256-GCM-encrypted data envelope embedded. No data, no tokens, no
hosting here — and the page makes zero network calls.

## How it works

- `index.html` + `css/` + `js/` — vanilla app, no build step, no dependencies.
- `scripts/build-html.mjs` inlines the source and embeds the local (gitignored)
  `data/data.enc.json` into `dist/HPT-Tracker.html`.
- The team unlocks the file with a shared passphrase (PBKDF2 → AES-256-GCM,
  decrypted in the browser). Edits apply on-device and travel to the owner as
  "📤 Send sync" emails, applied for everyone by the next morning's run.
- Retention is automatic: completed items drop after 2 business days, meeting
  history after 14 days (`scripts/publish.mjs` prunes on every encrypt, and the
  page enforces the same windows on display).

## Working on it

```
node scripts/pull-dist.mjs   # team file's embedded envelope -> data/data.enc.json
node scripts/sync.mjs        # decrypt -> data/data.json (needs .secrets/passphrase.txt)
node scripts/serve.mjs       # local preview (prints its URL; default port 8420)
node scripts/publish.mjs     # prune + re-encrypt data.json -> data.enc.json
node scripts/build-html.mjs  # rebuild dist/HPT-Tracker.html
```

The operational runbook (daily workflow, scheduled runs, conventions) lives in
`CLAUDE.md`; ownership handoff lives in `ONBOARDING.md`.
