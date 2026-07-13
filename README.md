# Cox HPT — Daily Stand-Up Tracker

A lightweight, no-VPN-needed web tracker for a daily stand-up call: per-speaker notes
and action items, advance purchase status, current risks, and team PTO/OOO — updated
after each call from the meeting transcript.

**Live page:** https://rodellt.github.io/wwt-action-tracker/

## How it works

- All tracker content lives in one **encrypted** file (`data/data.enc.json`,
  AES-256-GCM with a PBKDF2-derived key). The page asks for the team passphrase once
  per device and decrypts in the browser. The hosting is public; the data is not.
- After each stand-up, the meeting transcript is processed with Claude Code, which
  updates notes, action items (including ones verbally closed on the call), advance
  purchase status, risks, and PTO — then commits the re-encrypted file.
- Action items stay on the page until completed — either **verbally on the call**
  (picked up from the next transcript) or **manually** via the ✓ button.
- One-click completion for the whole team requires a GitHub fine-grained personal
  access token (Settings ⚙ on the page): repo `wwt-action-tracker`, permission
  **Contents: Read and write**, nothing else. Without a token, completions are saved
  on that device only and folded in at the next transcript update.

## Local preview

```
node scripts/serve.mjs
# → http://localhost:8420
```

## Repo layout

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | The site (vanilla, no build step) |
| `data/data.enc.json` | Encrypted tracker data (the only committed data) |
| `data/data.json` | Plaintext working copy — **gitignored** |
| `scripts/publish.mjs` / `sync.mjs` | Encrypt / decrypt between the two |
| `scripts/extract-docx.mjs` | Transcript text extraction |
| `CLAUDE.md` | The daily update workflow Claude Code follows |
