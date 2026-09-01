# Reddit success audit — August 1 Moraine Lake release

Checked July 30, 2026. Reddit reports are observational and can conflict; Parks
Canada's published rules remain authoritative.

## Repeated success patterns

- Be signed in and already positioned at the final Reserve control before
  8:00 a.m. Mountain.
- Use a laptop/desktop browser. Some users reported that openings appeared on a
  laptop but not their phone.
- Complete checkout quickly and have payment information ready.
- A slightly later morning departure may face less competition than the
  earliest departures. One recent user succeeded at 10:00 a.m. after preparing
  the exact slot in advance.
- Continue checking after the first wave. Users reported seats returning after
  about 5 minutes, around 15–23 minutes, at 45 minutes, and up to an hour later.
  A commonly reported cart timeout is about 20 minutes.
- Treat a gateway timeout after payment as ambiguous. Check the Parks Canada
  account and card activity before attempting another purchase, because one
  user reported a completed transaction without a confirmation page or email.

## How the armed runner now covers these reports

- The signed-in preflight passed on the exact August 1 last-minute cell.
- The user's best-time priority, 6:30–7:00 a.m., is first; every later daytime
  window remains in chronological fallback order. Reddit's lower-contention
  later-morning advice is retained as a fallback strategy rather than replacing
  the requested first choice.
- Reserve is preselected before release and sent against the calibrated Parks
  Canada server clock.
- A slow Reserve response is observed for 5 seconds instead of 1.5 seconds.
- After a validated final purchase click, the runner waits up to 90 seconds for
  confirmation and never clicks the final action twice.
- Recovery scans run for an hour, with 10-second checks during the expected
  19–30 minute cart-expiry wave.
- A 9:55 a.m. local notification and spoken alert asks the user to stay at the
  Mac for CAPTCHA, queue, sign-in, or payment intervention.

## Tactics deliberately not adopted

- Multiple simultaneous accounts/devices: reports conflict, and parallel
  sessions increase duplicate-purchase, profile-conflict, and security-check
  risk.
- Clearing cookies/cache or switching to incognito: one report lost its cart
  after clearing state; this would also discard the tested signed-in profile.
- Repeated Reserve clicks after an ambiguous response: the first request may
  already have created a hold.

## Sources

- [Recent Parks Canada shuttle failure and success reports](https://www.reddit.com/r/Banff/comments/1uoyjva/parks_canada_shuttle_2nd_unsuccessful_attempt_at/)
- [Lake Louise/Moraine shuttle reservation tips](https://www.reddit.com/r/Banff/comments/1enazwt/lake_louisemoraine_shuttle_reservation_tips/)
- [2026 launch-day queue and returned-seat reports](https://www.reddit.com/r/Banff/comments/1sm76ci/shuttle_reservation/)
- [Roam overload and ambiguous-payment report](https://www.reddit.com/r/Banff/comments/1tnebks/tips_for_booking_the_8x_roam_shuttle_to_lake/)
