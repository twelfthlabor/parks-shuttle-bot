# Live booking element audit — July 30, 2026

This is the release-day control map for the Parks Canada Moraine Lake shuttle
assistant. It separates the controls that improve speed from the validation
elements that prevent a fast but incorrect purchase.

No program can guarantee scarce tickets. Parks Canada controls inventory,
queues, human-verification challenges, account state, and payment acceptance.
The assistant uses one visible signed-in browser, does not bypass those
controls, and stops for human action when the result is ambiguous.

## Official release facts

- The remaining 60% of daytime shuttle seats opens at **8:00 a.m. Mountain
  Time exactly two days before departure**.
- A Parks Canada account is required to reserve online. Parks Canada recommends
  creating the account, signing in early, and practicing in advance.
- Choose **Moraine Lake** as the initial destination if it must be the first
  lake visited.
- A reservation covers one departure window, the Lake Connector, the return to
  Park and Ride, and free Park and Ride parking.
- The online reservation fee is CAD $3.50. Current shuttle fares are CAD
  $12.75 per adult, $6.00 per senior, and $4.00 per youth.

Official sources:

- [Parks Canada shuttle FAQ](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise/faq)
- [Parks Canada reservation policies](https://www.parks.canada.ca/termes-terms/reservation)
- [Lake Louise and Moraine Lake transit](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise)
- [Banff fees](https://parks.canada.ca/pn-np/ab/banff/visit/tarifs-fees)

## Speed-critical controls

| Stage | Live element or state | How the assistant uses it |
| --- | --- | --- |
| Session | `#login` | Detects a visible **Sign in** state before the release. |
| Results view | Accessible List button in `mat-button-toggle-group` | Switches to the time-window list without waiting on the removed legacy List-button ID. |
| Departure windows | `button[id^="mapLink-button-"]` | Reads all broad daytime windows and orders them by the configured preferences. |
| Window back control | `#map-back-button`, mobile variant, or accessible previous-map button | Returns immediately to test another window. |
| Exact date | `td[data-e2e-date="YYYY-MM-DD"]` | Prevents a broad “Available” card from being mistaken for availability on the target date. |
| Destination row | Row text beginning `Moraine Lake:` | Prevents selection of Lake Louise as the initial destination. |
| Rolling inventory | Row text containing `(Last Minute)` | Prefers the 60% rolling-release pool over a sold-out advance pool. |
| Cell state | `aria-label` and availability classes | Requires `Available` and rejects `Unavailable` or `Not Operating`. |
| Exact selection | Selected class or `aria-selected` | Confirms that the correct date cell is armed. |
| Reserve | `#reserveButton`, `#reserveButtonMulti`, or `#reserveButtonGridView` | Sends the first hold request from the already-selected cell. |
| Hold confirmation | `#proceedToCartButton` | Treats the hold as confirmed only when Proceed is visible and enabled. |
| Cart | `/cart` and `#proceedToCheckout` | Advances a confirmed hold into checkout. |
| Checkout | `/create-booking/reviewpolicies`, `/contactinfo`, `/partyinfo`, and `/payment/...` | Continues only through already-satisfied checkout pages. |
| Final confirmation | Visible Moraine Lake, target date, approved total, then a booking/confirmation number | Blocks a wrong-date, wrong-destination, or over-cap purchase. |

The current app also exposes an official server-time endpoint at
`/api/transactionlocation/servertime`. The release runner takes five samples
near 8:00 a.m. and uses the lowest round-trip sample to align the Reserve click
with Parks Canada's clock.

## Interruption and loss states

The assistant stops or hands control to the user for:

- sign-in, CAPTCHA, “verify you are human,” security checks, or a virtual queue;
- access-denied or temporary-block pages;
- an ambiguous response after Reserve, because retrying could duplicate an
  existing hold;
- a missing required checkout field or payment detail;
- an itinerary that does not visibly include the exact date and Moraine Lake;
- a missing, zero, malformed, or over-cap total;
- a final action whose result does not produce a visible confirmation.

It retries Reserve only when Parks Canada explicitly says the release time gate
is still closed. It does not retry an ambiguous request.

## Audit result on this Mac

- The read-only live application contract check passed for every required
  results, Reserve, cart, checkout, route, and server-clock marker.
- All 25 Node.js tests and all 6 SeleniumBase/Python tests passed.
- The isolated real-Chromium benchmark detected a DOM change in 9 ms and
  reached simulated checkout in 242 ms. This measures local assistant overhead,
  not Parks Canada network latency or ticket availability.
- The Finder launcher now keeps the Mac awake for live release and cancellation
  runs.
- Pre-arming now checks the next configured departure window when the first
  broad result lacks an exact-date Moraine Lake cell.

## Release-day sequence

1. Several days early, use launcher option 1 to confirm sign-in and saved
   contact/payment autofill.
2. At least one day early, use option 7 to verify the current live controls.
3. Before release, use option 5 for the no-hold exact-cell preflight.
4. Start option 2 at least ten minutes early and keep the visible Chrome window
   unobstructed.
5. Be ready to complete any human verification immediately.
6. Do not consider the ticket secured until a booking number and confirmation
   email are present.
