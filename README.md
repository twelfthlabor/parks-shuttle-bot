# Parks Shuttle Bot

Parks Shuttle Bot is a macOS booking helper for Parks Canada's Moraine Lake
shuttle. It opens the official reservation site in a visible Chrome window,
checks the requested date and departure window, and can move an available trip
from Reserve to checkout.

The default configuration does not submit the final purchase. Sign-in, queues,
CAPTCHA or WAF challenges, missing payment details, and unexpected booking
states are left for the user in the open browser.

## What it does

- Calculates the rolling release time in Mountain Time.
- Uses the exact Moraine Lake date cell instead of relying on a broad
  "Available" result card.
- Orders departure windows using `config.json`.
- Can preselect the target cell before release and click Reserve when the gate
  opens.
- Advances through Reserve, cart, and checkout when those controls are present.
- Watches for cancellations at a conservative interval.
- Records timing and limited control-state diagnostics under the ignored
  `output/` directory.

Playwright is the primary runner. A SeleniumBase runner is included as an
alternative and uses a separate browser profile.

## Requirements

- macOS
- Google Chrome
- Node.js 20 or newer
- pnpm 11

SeleniumBase also requires Python 3.11 or newer.

## Install

```bash
cd /path/to/parks-shuttle-bot
pnpm install
cp config.example.json config.json
pnpm test
pnpm verify-live
```

`verify-live` checks the public Parks Canada application for the exact-date,
Reserve, cart, checkout, and server-clock controls used by the bot. It does not
sign in, hold inventory, or submit a reservation.

## macOS launcher

Double-click **Parks Shuttle Bot.command** and choose a mode. The launcher uses
the bundled Codex Node.js runtime when it is available and installs project
dependencies on first use.

Run setup once before a release. Chrome will open with a persistent profile in
`.browser-profile/`; sign in to Parks Canada, then close the window. Do not
share or commit that directory.

## Command line

Replace the example date with the intended travel date.

```bash
# Save the Parks Canada sign-in session
pnpm run setup

# Open the live flow without holding seats
pnpm run dry-run -- --date 2026-09-15

# Select the exact date cell without clicking Reserve
pnpm run preflight -- --date 2026-09-15

# Wait for the official release and attempt the configured flow
pnpm run run -- --date 2026-09-15

# Check periodically for returned inventory
pnpm run watch -- --date 2026-09-15

# Create a temporary hold and rehearse the path to checkout
pnpm run checkout-test -- --date 2026-09-15
```

`checkout-test` can hold real inventory. It stops before payment or final
confirmation.

## Configuration

Copy `config.example.json` to `config.json` and review it before every live
run. The local file is ignored by Git.

The settings most likely to need attention are:

- `partySize` and `passengerCategories`
- `preferredDepartureWindows`
- `autoHold`
- `autoProceedToCheckout`
- `autoPrepareCheckout`
- `autoSubmitPurchase`
- `maxPurchaseCAD`

The checked-in example sets `autoSubmitPurchase` to `false`. Do not enable it
without reviewing the target date, passenger mix, destination, and total cap.
Never put a password, card number, security code, session cookie, or account
recovery value in the project files.

## SeleniumBase runner

The alternative runner creates `.venv/` and `.seleniumbase-profile/` locally.
Both are ignored by Git.

```bash
pnpm run seleniumbase:setup
pnpm run seleniumbase:dry-run -- --date 2026-09-15
pnpm run seleniumbase:preflight -- --date 2026-09-15
pnpm run seleniumbase -- --date 2026-09-15
pnpm run seleniumbase:watch -- --date 2026-09-15
```

The SeleniumBase path does not enable UC or CDP stealth modes.

## Verification

```bash
pnpm test
python -m unittest discover -s test -p "test_*.py"
pnpm benchmark-dom
pnpm verify-live
pnpm check-sensitive
```

`benchmark-dom` runs the detection and Reserve-to-checkout path against a local
Chromium page. It does not contact Parks Canada inventory. `check-sensitive`
fails if a tracked file contains a local browser profile, live config, common
credential format, or another blocked path.

GitHub Actions runs the Node tests, Python tests, and sensitive-file check on
every push and pull request.

## Limits

This project cannot guarantee a reservation. Inventory can disappear between
the availability check and the hold, and Parks Canada can change its release
rules, controls, queue, or verification requirements. Keep the Mac awake, stay
at the browser during the release, and treat the booking as complete only when
Parks Canada shows a confirmation number.

The bot does not bypass queues, CAPTCHA, sign-in, payment checks, or other
access controls. It uses one visible browser session and does not retry an
ambiguous Reserve result because the first attempt may already have created a
hold.

## Project notes

- [Booking flow and source links](docs/RESEARCH.md)
- [Live control audit](docs/LIVE-ELEMENT-AUDIT-2026-07-30.md)
- [Release investigation](docs/LIVE-RELEASE-RESEARCH-2026-07-26.md)
- [SeleniumBase assessment](docs/SELENIUMBASE-ASSESSMENT.md)
- [Local data and repository security](docs/SECURITY.md)
