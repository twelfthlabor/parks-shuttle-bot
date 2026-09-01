# SeleniumBase assessment

## Decision

Keep Playwright as the primary release-tested workflow, with SeleniumBase
available as an opt-in, standard-WebDriver backend.

The current Playwright implementation already provides the capabilities this
project needs: a persistent signed-in Chrome profile, live locators with
actionability checks, browser-context initialization scripts, Node callbacks
from page JavaScript, and direct control of the installed Chrome browser.
Changing to Python/Selenium/WebDriver on release day adds driver and dependency
risk without reducing Parks Canada's network or server latency. For that
reason, the SeleniumBase integration lives alongside rather than replacing the
existing runner.

SeleniumBase's ordinary testing features are useful for Python-based UI test
suites, but are not a performance advantage here. Its UC and CDP modes are
explicitly presented as ways to evade bot detection or handle CAPTCHAs. Those
modes are not appropriate for this public reservation service and are not used
by this project. The integration uses `seleniumbase.Driver()` in standard
Chrome/WebDriver mode, a separate `.seleniumbase-profile`, and the same
human-in-the-loop stop before payment or final confirmation.

## The early “Available” state

The live grid exposes the July 28 Moraine Lake last-minute cell as
`Available` before 8:00 a.m. Mountain Time, while the reservation service
enforces a separate server-side release gate. This is not evidence that seats
can be reserved early.

The safe advantage is already implemented:

1. Open the exact preferred time-window grid before release.
2. Select the exact July 28 Moraine Lake last-minute cell.
3. Verify that Reserve is visible and actionable without clicking it.
4. Keep the authenticated browser and origin connection warm.
5. Resample the official server clock close to release.
6. Bring Chrome forward and position the mouse over Reserve for the user's
   release-time click.

No client-side state change can guarantee inventory once the server begins
accepting reservations.

## Reliability improvements applied

- Pre-arm 120 seconds before release instead of 30 seconds.
- Revalidate the signed-in session on the live results page.
- Confirm Reserve actionability using a no-click Playwright trial.
- Take five server-clock samples ten seconds before release and use the
  lowest-round-trip sample.
- Bring Chrome forward and hover the mouse over Reserve five seconds before
  release.
- Keep one persistent browser session and avoid parallel or aggressive access.

## Primary references

- [SeleniumBase feature list](https://seleniumbase.io/help_docs/features_list/)
- [SeleniumBase installation](https://seleniumbase.io/help_docs/install/)
- [SeleniumBase UC Mode](https://seleniumbase.io/help_docs/uc_mode/)
- [SeleniumBase CDP Mode](https://seleniumbase.io/examples/cdp_mode/ReadMe/)
- [Playwright auto-waiting](https://playwright.dev/docs/actionability)
- [Playwright BrowserContext API](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Parks Canada shuttle FAQ](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise/faq)
- [Parks Canada reservation policies](https://www.parks.canada.ca/termes-terms/reservation)
