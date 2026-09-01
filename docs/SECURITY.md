# Local data and repository security

This project keeps account and run state local. The following paths must never
be committed or shared:

- `.browser-profile/` and `.seleniumbase-profile/` — browser cookies, sign-in
  state, autofill metadata, and browsing history.
- `config.json` — the live booking preferences for this machine.
- `output/` and `*.log` — run diagnostics that may describe a booking session.
- `.env*`, `credentials.json`, `secrets.json`, private keys, and certificates.
- `node_modules/` and `.venv/` — generated dependency trees.

Only `config.example.json` belongs in the repository. It contains safe defaults
and no account, contact, or payment information. Payment card numbers, security
codes, passwords, session cookies, and account recovery data belong only in the
Parks Canada account or the browser's secure storage.

Run `pnpm check-sensitive` (or `npm run check-sensitive`) before a commit. The
same check runs in GitHub Actions and rejects tracked local-state paths and
common credential formats.

The assistant deliberately hands control to the visible browser for sign-in,
queues, CAPTCHA or WAF challenges, missing payment data, and unexpected booking
states. Do not add code that stores those values or bypasses those controls.
