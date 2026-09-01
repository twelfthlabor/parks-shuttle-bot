# July 26 live-release research

Target: two Moraine Lake shuttle seats for July 28, 2026. Release: July 26
at 8:00:00 a.m. Mountain Daylight Time, which is 10:00:00 a.m. in Toronto.

Research and live, read-only network inspection were completed before release
on July 26. No seat hold or purchase was created during the inspection.

## The important finding

Do not wait for the ordinary red row to turn green.

The grid contains two different inventory pools for the same time:

| Grid row | Pre-release state | What it represents |
| --- | --- | --- |
| `Moraine Lake: 6:30am-7am` | Red / Unavailable | The advance-release allocation, already sold out |
| `Moraine Lake: 6:30am-7am (Last Minute)` | Green / Available | The 60% rolling-release allocation, loaded in advance but time-gated |

The last-minute cell is the correct cell. Its green appearance before 8:00 is
not proof that it can already be reserved. Parks Canada's server applies a
reservation-window rule when Reserve is submitted.

Official policy confirms that 60% of shuttle seats are released at 8:00 a.m.
local park time exactly two days before departure:

- [Parks Canada reservation policies](https://parks.canada.ca/termes-terms/reservation)
- [Parks Canada Lake Louise and Moraine Lake information](https://parks.canada.ca/pn-np/ab/banff/visit/les10-top10/louise)
- [Banff and Lake Louise Tourism shuttle guide](https://www.banfflakelouise.com/explore-the-park/moraine-lake-shuttle)

## Live application evidence

For the July 28, 6:30–7:00 a.m. window, the public application returned:

- Advance row resource `-2147476638`: zero remaining reservable quota.
- Last-minute row resource `-2147471958`: 70 remaining reservable seats before
  release.
- Advance row schedule `-2147483230`: no two-day release window.
- Last-minute row schedule `-2147483229`: a maximum reservation window with
  `offsetDays: -2` and `offsetHours: 8`.

The last-minute resource description also states that its limited spaces are
released daily at 8:00 a.m. Mountain Time two days before departure.

The important public endpoints observed were:

- `POST /api/availability/dailyactivity`
- `GET /api/availability/resourcestatus`
- `GET /api/availability/resourcedailyavailability`
- `GET /api/dateschedule/resourcelocationid`
- `GET /api/transactionlocation/servertime`

These were inspected to understand the public UI. The release runner does not
hammer these endpoints or bypass the normal booking page.

## Why status monitoring is slower

A 30-second observation of the exact grid showed no background availability
polling. Leaving the page open therefore does not fetch a new status at 8:00.
Refreshing or repeatedly rescanning would add an Angular page load and network
round trips at the busiest moment.

More importantly, there is no useful status transition to monitor: the correct
last-minute cell is already green. The fastest signal is the known server-time
gate itself.

## Implemented release path

1. Open the exact-date results two minutes early.
2. Select the preferred time-window card.
3. Select the exact Moraine Lake `(Last Minute)` cell.
4. Verify that Reserve is visible and enabled without clicking it.
5. Sample Parks Canada's server-time endpoint five times ten seconds before
   release and use the lowest-latency sample.
6. Click the pre-armed Reserve button 50 milliseconds after the calibrated
   8:00:00 server boundary.
7. If and only if Parks Canada explicitly replies that reservation is not yet
   allowed, dismiss that message and retry the same selected cell every 150
   milliseconds within a ten-second window.
8. As soon as the hold is confirmed, click Proceed and then Checkout.
9. Continue through checkout pages whose required fields are already satisfied
   by the Parks Canada profile.
10. With explicit local configuration, submit only after revalidating Moraine
    Lake, the target date, and a positive total within the configured CAD cap.
    Missing fields, an unexpected total, or human verification causes an
    immediate visible handoff.

An ambiguous Reserve result is not retried because the first click may already
have created a hold. Queue, CAPTCHA, WAF, sign-in, and access-denied states are
also handed to the user unchanged.

## Community evidence

Community reports are anecdotal, but they match the live application evidence.
Recent July 2026 reports add several practical patterns:

- Successful users were signed in on a laptop with the desired grid already
  open and only Reserve left to press.
- Saving contact, billing, and payment information in the Parks Canada account
  reduced checkout time.
- Inventory may disappear in under 30 seconds.
- Uncompleted carts commonly return inventory around 8:20 and in later waves;
  users report openings five minutes later, around 8:23, and through 9:00.
- Later daytime windows can be easier than the most competitive early windows.

The runner therefore searches all configured windows and, if the first wave
fails, continues automatically until 9:00 Mountain with a moderately faster
8:19–8:30 cart-expiry window.

- [Lake Louise/Moraine shuttle reservation tips](https://www.reddit.com/r/Banff/comments/1enazwt/lake_louisemoraine_shuttle_reservation_tips/)
- [Lake Louise transport discussion](https://www.reddit.com/r/Banff/comments/1d75has/)
- [July 2026 unsuccessful-attempt discussion and successful tactics](https://www.reddit.com/r/Banff/comments/1uoyjva/parks_canada_shuttle_2nd_unsuccessful_attempt_at/)
- [Current shuttle FAQ and cart-return discussion](https://www.reddit.com/r/Banff/comments/1k17ka4/2025_moraine_lake_lake_louise_parking_shuttle_faq/)

Official policy and live application behavior take precedence over these
reports.

## Today’s operational checklist

- Keep the Mac awake, plugged in, and on stable internet.
- Quit any Chrome window using this project's `.browser-profile` before the
  one-time runner starts.
- Confirm the project profile is signed in before 9:55 a.m. Toronto time.
- Keep the Parks Canada password/verification method and payment card ready.
- Watch the visible browser from 9:58 a.m.
- If automation stops, immediately complete the missing category, verification,
  or payment field. The bot will never bypass a CAPTCHA or queue.
- A hold is not a booking. Success requires a Parks Canada booking number and
  confirmation email.
