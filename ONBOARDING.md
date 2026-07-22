# Taking over the Cox HPT Stand-Up Tracker

This is the handoff runbook. If you're reading this because you're inheriting the
tracker from its previous owner, the whole takeover is about 30 minutes.

**Live page:** https://rodellt.github.io/wwt-action-tracker/
**How it works in one paragraph:** the page is static (GitHub Pages). All meeting
content lives in one AES-256-encrypted file, `data/data.enc.json`; the page asks
viewers for the team passphrase once and decrypts in the browser. Edits made on the
page commit straight back to this repo using a shared "edit key"
(`data/edit-key.enc.json` — a GitHub token, itself encrypted with the same
passphrase). Every weekday a Claude routine pulls the meeting transcript from Teams
via a Microsoft 365 connector, extracts notes / action items / risks / PTO, and
commits the updated encrypted file. Nothing sensitive is ever committed in
plaintext: no transcripts, no passphrase, no tokens.

## What you need from the previous owner (or an admin)

1. **The team passphrase** — the same one the team types into the page. Get it
   directly (chat/call); it is intentionally written down nowhere in this repo.
2. **Repo access** — either transfer this repository to your GitHub account /
   a team org (Settings → General → Transfer ownership; GitHub Pages re-enables
   under Settings → Pages, branch `main`, root), or be added as an admin
   collaborator.
3. **A seat on the daily meeting** — the routine reads the "Cox HPT" event from
   YOUR calendar, so you must be an invitee.

## Setup on your machine

1. Install the Claude desktop app / Claude Code, and Node 18+, git, and the
   GitHub CLI (`gh auth login`).
2. Clone the repo and create the local secrets file:
   ```
   git clone https://github.com/<owner>/wwt-action-tracker
   cd wwt-action-tracker
   mkdir .secrets
   # put the passphrase (one line) into .secrets/passphrase.txt
   node scripts/sync.mjs   # should print "Decrypted data/data.enc.json ..." — proves the passphrase works
   ```
3. **Connect your Microsoft 365 connector** in the Claude app (Settings →
   Connectors) AND at https://claude.ai/customize/connectors (that one is used by
   the cloud routine). It authenticates as you, read-only usage.
4. **Publish YOUR edit key** so the previous owner's token can be revoked:
   create a fine-grained GitHub PAT (this repo only, permission
   "Contents: Read and write", ~1 year expiry), then run
   `node scripts/publish-edit-key.mjs` and paste it at the prompt.
   The previous owner (or an admin) should then revoke the old token on GitHub.
5. **Recreate the automation:**
   - Cloud routine (primary): at https://claude.ai/code/routines create a weekday
     routine mirroring the "SCHEDULED DAILY RUN" section of CLAUDE.md — repo
     checkout of this repo, Microsoft 365 connector attached, and the passphrase
     provided in the routine's instructions so it can run `scripts/sync.mjs` /
     `scripts/publish.mjs` and push with the decrypted edit key. (Ask Claude Code
     to set this up for you — point it at CLAUDE.md.)
   - Local fallback (optional but recommended): a scheduled task in the Claude
     desktop app at ~9:45 AM Central that runs the same workflow only when the
     cloud routine hasn't already processed the day.
6. Do a dry run: tell Claude Code "process today's transcript" after a stand-up
   and check the live page updates.

## Routine care and feeding

- **Connector re-auth:** the Microsoft 365 connector occasionally needs
  reconnecting (corporate token expiry). Symptom: the daily run reports it can't
  reach transcripts. Fix: reconnect at claude.ai/customize/connectors.
- **Edit key expiry:** fine-grained PATs expire (max ~1 year). Symptom: page edits
  fail with "edit key was rejected". Fix: new PAT → `node scripts/publish-edit-key.mjs`.
- **Rotating the passphrase:** re-encrypt with a new one (`node scripts/publish.mjs`
  after updating .secrets/passphrase.txt), re-publish the edit key, and give the
  team the new passphrase. Old links keep working; old passphrase stops.
- **Missed days:** the daily run catches up automatically (it processes every
  weekday since the last recorded meeting; holidays are skipped).
- **Page says an old version in the footer:** hard refresh (Ctrl+F5).

## Departing-owner checklist

- [ ] Hand over the passphrase.
- [ ] Transfer the repo (or confirm the successor has admin) — remember GitHub
      Pages must be re-enabled after a transfer.
- [ ] Successor publishes their edit key; revoke the old PAT on GitHub.
- [ ] Delete/disable your routines (claude.ai/code/routines) and local scheduled
      task once the successor's are running.
- [ ] Disconnect your Microsoft 365 connector if the account is going away.
