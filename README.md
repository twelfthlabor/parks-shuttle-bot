# Parks Shuttle Bot

A guarded macOS and Windows helper for Parks Canada's Moraine Lake shuttle. It
uses a visible browser to find the exact travel date, prefer configured departure
windows, and continue from Reserve to checkout.

Final purchase is disabled by default. The user retains control for sign-in,
queues, CAPTCHA/WAF challenges, payment details, and unexpected booking states.

## Features

- Times the rolling 8:00 a.m. Mountain Time release using the Parks Canada
  server clock and preselects the exact date cell.
- Prioritizes Alpine Start departures (midnight–4:59 a.m.) when
  `monitorAlpineStart` is enabled, then applies `preferredDepartureWindows`.
- Watches for cancellations at a configurable, conservative interval.
- Can advance through Reserve, cart, and checkout without submitting payment.
- Stores limited diagnostics in the ignored `output/` directory.
- Includes a Playwright runner for macOS and Windows and an optional macOS-only
  SeleniumBase runner.

## Requirements

- macOS or Windows
- Node.js 20 or newer
- pnpm 11 or npm
- Google Chrome, or Playwright's bundled Chromium

The SeleniumBase runner additionally needs Python 3.11 or newer.

## Quick start

Install dependencies and create the local configuration:

```bash
pnpm install
cp config.example.json config.json
pnpm test
```

On macOS, double-click **Parks Shuttle Bot.command**. On Windows, double-click
**Parks Shuttle Bot.cmd**. The launchers create `config.json` when needed and
offer setup, release, cancellation-watch, rehearsal, and verification modes.

Run setup once to save the Parks Canada sign-in session in
`.browser-profile/`, then close the browser. Keep the computer awake and stay
near it during a live run.

## Command line

Replace the example date with the intended travel date:

```bash
pnpm run setup
pnpm run dry-run -- --date 2026-09-15
pnpm run preflight -- --date 2026-09-15
pnpm run run -- --date 2026-09-15
pnpm run watch -- --date 2026-09-15
pnpm run checkout-test -- --date 2026-09-15
```

`dry-run` never holds seats. `preflight` selects the exact date cell without
reserving. `checkout-test` may create a temporary cart hold but stops before
payment or final confirmation.

## Configuration

Review `config.json` before every live run, especially:

- `partySize` and `passengerCategories`
- `monitorAlpineStart` and `preferredDepartureWindows`
- `pollSeconds`, `pollJitterSeconds`, and `maxWatchMinutes`
- `autoHold`, `autoProceedToCheckout`, and `autoPrepareCheckout`
- `autoSubmitPurchase` and `maxPurchaseCAD`

With `monitorAlpineStart: true`, pre-dawn departures are considered first in
chronological order. Set it to `false` to use only the configured daytime
preference order.

The checked-in example keeps `autoSubmitPurchase` false. Do not enable it
without confirming the date, passenger mix, destination, and price cap.

## Verification

```bash
pnpm test
python -m unittest discover -s test -p "test_*.py"
pnpm benchmark-dom
pnpm verify-live
pnpm check-sensitive
```

`benchmark-dom` tests detection and the Reserve-to-checkout path locally.
`verify-live` checks the public site's controls without signing in, holding
inventory, or submitting a reservation. CI runs the automated tests and
sensitive-file check on every push and pull request.

## Security and limits

Never commit or share `config.json`, `.browser-profile/`,
`.seleniumbase-profile/`, `output/`, credentials, payment details, cookies, or
account-recovery data. These local paths are ignored by Git, and
`pnpm check-sensitive` rejects tracked sensitive paths and common credential
formats.

The bot does not bypass access controls and cannot guarantee a reservation.
Inventory and site controls can change at any time; treat a booking as complete
only when Parks Canada displays a confirmation number.

## Additional notes

- [Booking flow and sources](docs/RESEARCH.md)
- [Live control audit](docs/LIVE-ELEMENT-AUDIT-2026-07-30.md)
- [Release investigation](docs/LIVE-RELEASE-RESEARCH-2026-07-26.md)
- [SeleniumBase assessment](docs/SELENIUMBASE-ASSESSMENT.md)
- [Local data and repository security](docs/SECURITY.md)
