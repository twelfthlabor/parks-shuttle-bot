import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  buildSearchUrl,
  checkoutStageFrom,
  findMoraineAvailability,
  isAlpineSlotLabel,
  isAvailableSlotLabel,
  isFinalPurchaseAction,
  orderSlotLabels,
  releaseTimeFor,
  shouldAutoHold,
  slotLabelKey,
  slotStartMinutes,
  targetDateHeader,
  validateAutomationConfig
} from "../src/lib.mjs";

test("calculates the September rolling release in Mountain Time", () => {
  const release = releaseTimeFor("2026-09-15");
  assert.equal(release.toISO(), "2026-09-13T08:00:00.000-06:00");
  assert.equal(release.zoneName, "America/Edmonton");
});

test("formats the date exactly like the Parks Canada availability grid", () => {
  assert.equal(targetDateHeader("2026-09-15"), "Tue, Sep 15");
});

test("builds the verified Parks Canada shuttle search URL for two people", () => {
  const now = DateTime.fromISO("2026-07-23T19:00:00", { zone: "America/Edmonton" });
  const url = new URL(buildSearchUrl("2026-09-15", 2, now));
  assert.equal(url.hostname, "reservation.pc.gc.ca");
  assert.equal(url.pathname, "/create-booking/results");
  assert.equal(url.searchParams.get("startDate"), "2026-09-15");
  assert.equal(url.searchParams.get("endDate"), "2026-09-16");
  assert.deepEqual(
    JSON.parse(url.searchParams.get("peopleCapacityCategoryCounts")),
    [[-32767, null, 2, null]]
  );
});

test("orders candidate cards using configured time preference", () => {
  const labels = [
    "Time Slot 12pm-1pm Departures Available",
    "Time Slot 6:30am-7am Departures Available",
    "Time Slot 4pm-5pm Departures Available"
  ];
  const ordered = orderSlotLabels(labels, ["4pm-5pm", "6:30am-7am"]);
  assert.match(ordered[0], /4pm-5pm/);
  assert.match(ordered[1], /6:30am-7am/);
});

test("recognizes Alpine Start windows by product name or early AM clock time", () => {
  assert.equal(isAlpineSlotLabel("Time Slot 3am-4am Departures Available"), true);
  assert.equal(isAlpineSlotLabel("Alpine Start 4am Departures Available"), true);
  assert.equal(isAlpineSlotLabel("Time Slot 12am-1am Departures Available"), true);
  assert.equal(isAlpineSlotLabel("Time Slot 6:30am-7am Departures Available"), false);
  assert.equal(isAlpineSlotLabel("Time Slot 4pm-5pm Departures Available"), false);
  assert.equal(isAlpineSlotLabel("Time Slot 6:45am-7:45am Departures Available"), false);
  assert.equal(isAlpineSlotLabel(""), false);
});

test("parses the leading departure clock time as minutes since midnight", () => {
  assert.equal(slotStartMinutes("Time Slot 6:30am-7am Departures Available"), 390);
  assert.equal(slotStartMinutes("3am-4am Available"), 180);
  assert.equal(slotStartMinutes("12am-1am Available"), 0);
  assert.equal(slotStartMinutes("4:15pm-5pm Available"), 975);
  assert.equal(slotStartMinutes("no clock time here"), null);
});

test("puts Alpine Start windows first in chronological order when enabled", () => {
  const labels = [
    "Time Slot 6:30am-7am Departures Available",
    "Time Slot 4am-5am Departures Available",
    "Time Slot 3am-4am Departures Available",
    "Time Slot 9am-10am Departures Available"
  ];
  const preferred = ["6:30am-7am", "9am-10am"];

  const withoutAlpine = orderSlotLabels(labels, preferred);
  assert.match(withoutAlpine[0], /6:30am-7am/);

  const withAlpine = orderSlotLabels(labels, preferred, { alpineFirst: true });
  assert.match(withAlpine[0], /3am-4am/);
  assert.match(withAlpine[1], /4am-5am/);
  assert.match(withAlpine[2], /6:30am-7am/);
  assert.match(withAlpine[3], /9am-10am/);
});

test("keeps the daytime preference order when Alpine Start is disabled", () => {
  const labels = [
    "Time Slot 3am-4am Departures Available",
    "Time Slot 6:30am-7am Departures Available"
  ];
  const ordered = orderSlotLabels(labels, ["6:30am-7am"], {});
  assert.match(ordered[0], /6:30am-7am/);
});

test("recognizes duplicated live Available text without matching Unavailable", () => {
  assert.equal(
    isAvailableSlotLabel("Time Slot 6:30am-7am Departures AvailableAvailable"),
    true
  );
  assert.equal(
    isAvailableSlotLabel("Time Slot 6:30am-7am Departures UnavailableUnavailable"),
    false
  );
  assert.equal(
    slotLabelKey("Time Slot 6:30am-7am Departures AvailableAvailable"),
    slotLabelKey("Time Slot 6:30am-7am Departures Available")
  );
});

test("never auto-holds in no-hold or dry-run mode", () => {
  assert.equal(shouldAutoHold({ autoHold: true }, {}), true);
  assert.equal(shouldAutoHold({ autoHold: true }, { noHold: true }), false);
  assert.equal(shouldAutoHold({ autoHold: true }, { dryRun: true }), false);
  assert.equal(shouldAutoHold({ autoHold: false }, {}), false);
});

test("validates fare counts and the automatic-purchase cap", () => {
  assert.equal(
    validateAutomationConfig({
      partySize: 2,
      passengerCategories: { adult: 2, senior: 0 },
      autoSubmitPurchase: true,
      maxPurchaseCAD: 40
    }),
    true
  );
  assert.throws(
    () =>
      validateAutomationConfig({
        partySize: 2,
        passengerCategories: { adult: 1, senior: 0 }
      }),
    /add up to partySize/
  );
  assert.throws(
    () =>
      validateAutomationConfig({
        partySize: 2,
        autoSubmitPurchase: true,
        maxPurchaseCAD: 0
      }),
    /maxPurchaseCAD/
  );
});

test("selects exact-date Moraine Lake last-minute availability", () => {
  const matrix = [
    [
      { text: "Activity" },
      { text: "Mon, Sep 14" },
      { text: "Tue, Sep 15" }
    ],
    [
      { text: "Moraine Lake: 9am-10am" },
      { aria: "Moraine Lake Unavailable" },
      { aria: "Moraine Lake Unavailable" }
    ],
    [
      { text: "Moraine Lake: 9am-10am (Last Minute)" },
      { aria: "Moraine Lake Unavailable" },
      { aria: "Moraine Lake: 9am-10am (Last Minute) Available" }
    ],
    [
      { text: "Lake Louise: 9am-10am (Last Minute)" },
      { aria: "Lake Louise Available" },
      { aria: "Lake Louise Available" }
    ]
  ];

  assert.deepEqual(findMoraineAvailability(matrix, "Tue, Sep 15"), {
    rowIndex: 2,
    columnIndex: 2,
    rowLabel: "Moraine Lake: 9am-10am (Last Minute)",
    status: "Moraine Lake: 9am-10am (Last Minute) Available "
  });
});

test("does not mistake Unavailable for Available", () => {
  const matrix = [
    [{ text: "Activity" }, { text: "Tue, Sep 15" }],
    [
      { text: "Moraine Lake: 9am-10am (Last Minute)" },
      { aria: "Moraine Lake Unavailable", classes: "chart-cell--unavailable" }
    ]
  ];
  assert.equal(findMoraineAvailability(matrix, "Tue, Sep 15"), null);
});

test("detects Alpine Start availability rows without the colon format", () => {
  const matrix = [
    [{ text: "Activity" }, { text: "Tue, Sep 15" }],
    [
      { text: "Moraine Lake Alpine Start 3am-4am (Last Minute)" },
      { aria: "Moraine Lake Alpine Start 3am-4am (Last Minute) Available" }
    ],
    [
      { text: "Moraine Lake: 6:30am-7am (Last Minute)" },
      { aria: "Moraine Lake Unavailable" }
    ]
  ];

  assert.deepEqual(findMoraineAvailability(matrix, "Tue, Sep 15"), {
    rowIndex: 1,
    columnIndex: 1,
    rowLabel: "Moraine Lake Alpine Start 3am-4am (Last Minute)",
    status: "Moraine Lake Alpine Start 3am-4am (Last Minute) Available "
  });
});

test("recognizes checkout stages without treating checkout as a purchase", () => {
  assert.equal(checkoutStageFrom("Passenger details", "/checkout"), "checkout");
  assert.equal(checkoutStageFrom("Order summary and credit card"), "payment");
  assert.equal(checkoutStageFrom("Your cart"), "cart");
  assert.equal(
    checkoutStageFrom("", "https://reservation.pc.gc.ca/create-booking/reviewpolicies"),
    "checkout"
  );
  assert.equal(
    checkoutStageFrom("", "https://reservation.pc.gc.ca/create-booking/payment/checkout"),
    "payment"
  );
  assert.equal(isFinalPurchaseAction("Proceed to checkout"), false);
  assert.equal(isFinalPurchaseAction("Reserve"), false);
  assert.equal(isFinalPurchaseAction("Proceed"), false);
  assert.equal(isFinalPurchaseAction("Checkout"), false);
});

test("blocks final purchase action labels", () => {
  assert.equal(isFinalPurchaseAction("Confirm and pay"), true);
  assert.equal(isFinalPurchaseAction("Complete reservation"), true);
  assert.equal(isFinalPurchaseAction("Pay now"), true);
});
