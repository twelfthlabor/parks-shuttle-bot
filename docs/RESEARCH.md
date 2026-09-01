# Research and booking strategy

Research checked July 26, 2026. Parks Canada is the primary source throughout;
community reports are used only for observed booking tactics.

## Confirmed process

1. Create and test a Parks Canada Reservation Service account in advance.
2. For a September departure, target the rolling release at **8:00 a.m.
   Mountain Time two calendar days before the trip**. Sixty percent of seats
   are held for this release.
3. Search under **Day Use → Shuttle to Lake Louise and Moraine Lake (Banff)**,
   choose two people, the target date, and Moraine Lake as the first
   destination.
4. Complete checkout. A booking is not complete until Parks Canada provides a
   booking number.
5. On the trip date, park free at the Lake Louise Park and Ride (Lake Louise
   Ski Resort, 1 Whitehorn Road), check in during the booked one-hour window,
   and take the shuttle to the first destination shown on the reservation.
6. The ticket also provides the Lake Connector between the two lakes and a
   return to Park and Ride.

The live site was inspected while building the assistant. Its results URL
accepts the date and party size directly. The results UI first displays broad
time-window cards, then an exact-date grid. A broad card can say “Available”
while the target date is unavailable or restricted, so the assistant validates
the exact Moraine Lake row and date column before clicking.

## Why this cannot be guaranteed

- Inventory may be exhausted before this browser obtains a cart hold.
- Parks Canada may use a virtual queue, CAPTCHA/WAF challenge, session expiry,
  or other security controls.
- Sign-in providers can require a password or one-time code.
- Page structure and reservation rules can change.
- Payment can be declined, and the user must verify the final booking number.

The assistant deliberately does not evade queues, solve or bypass CAPTCHA, or
submit payment. It uses a visible browser and hands control to the user.

## Best-odds strategy

- Prefer three or more possible September dates if the itinerary allows it.
- Keep every daytime window acceptable; strict time filters reduce the odds.
- Run account setup and a dry run several days before release.
- Start the real command at least 10 minutes early.
- Keep only one reservation attempt/profile active. Multiple parallel sessions
  can invalidate sign-in or trigger security controls.
- Save contact and payment details through the Parks Canada account or Chrome's
  secure UI; never store them in this project's configuration.
- Have the correct passenger age categories configured.
- If the 8:00 release fails, continue through at least 8:30. July 2026 users
  report that abandoned 20-minute cart holds begin returning around 8:20 and
  other openings can reappear through 9:00.
- Accept any workable daytime window. Recent users report that the earliest
  departures are substantially more competitive.
- Keep a backup reservation with Roam Public Transit’s Reservable Super Pass or
  a licensed commercial shuttle. A Roam Reservable Super Pass includes access
  to the Parks Canada Lake Connector, subject to current conditions.

## Official sources

- [Visiting Lake Louise and Moraine Lake](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise)
- [Parks Canada shuttle FAQ](https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise/faq)
- [Parks Canada reservation policies](https://parks.canada.ca/termes-terms/reservation)
- [How to make a reservation](https://parks.canada.ca/voyage-travel/reserve/instructions)
- [Banff National Park fees](https://parks.canada.ca/pn-np/ab/banff/visit/tarifs-fees)
- [Parks Canada terms and reCAPTCHA notice](https://parks.canada.ca/termes-terms)

## Recent user reports

- [July 2026 booking failures, successful tactics, and returned cart holds](https://www.reddit.com/r/Banff/comments/1uoyjva/parks_canada_shuttle_2nd_unsuccessful_attempt_at/)
- [Current community shuttle FAQ](https://www.reddit.com/r/Banff/comments/1k17ka4/2025_moraine_lake_lake_louise_parking_shuttle_faq/)
