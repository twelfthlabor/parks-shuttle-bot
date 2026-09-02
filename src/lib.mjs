import { DateTime } from "luxon";

export const PARK_TIME_ZONE = "America/Edmonton";
export const HOME_URL = "https://reservation.pc.gc.ca/";

const SEARCH_IDS = Object.freeze({
  transactionLocationId: "-2147483647",
  resourceLocationId: "-2147483642",
  mapId: "-2147483634",
  searchTabGroupId: "3",
  bookingCategoryId: "9"
});

export function validateDate(date) {
  const parsed = DateTime.fromISO(date, { zone: PARK_TIME_ZONE });
  if (!parsed.isValid || parsed.toISODate() !== date) {
    throw new Error(`Invalid date "${date}". Use YYYY-MM-DD.`);
  }
  if (parsed.year !== 2026 || parsed < DateTime.fromISO("2026-06-01", { zone: PARK_TIME_ZONE }) ||
      parsed > DateTime.fromISO("2026-10-12", { zone: PARK_TIME_ZONE })) {
    throw new Error("The 2026 Moraine Lake shuttle season is June 1 through October 12.");
  }
  return parsed;
}

export function releaseTimeFor(date) {
  return validateDate(date)
    .minus({ days: 2 })
    .set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
}

export function targetDateHeader(date) {
  return validateDate(date).toFormat("ccc, LLL d");
}

export function buildSearchUrl(date, partySize, now = DateTime.now()) {
  validateDate(date);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
    throw new Error("partySize must be an integer from 1 to 10.");
  }

  const endDate = validateDate(date).plus({ days: 1 }).toISODate();
  const params = new URLSearchParams({
    ...SEARCH_IDS,
    startDate: date,
    endDate,
    nights: "1",
    isReserving: "true",
    peopleCapacityCategoryCounts: JSON.stringify([[-32767, null, partySize, null]]),
    searchTime: now.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS"),
    flexibleSearch: JSON.stringify([false, false, null, 1])
  });
  return `${HOME_URL}create-booking/results?${params.toString()}`;
}

export function normalizeWindow(value) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
}

export function isAvailableSlotLabel(value) {
  const label = String(value ?? "");
  return /Available/i.test(label) && !/Unavailable/i.test(label);
}

export function slotLabelKey(value) {
  return normalizeWindow(value)
    .replace(/partialavailability|unavailable|available/g, "");
}

/**
 * Parses the leading departure clock time from a slot label such as
 * "Time Slot 3am-4am Departures Available" or "Alpine Start 4:00am".
 * Returns minutes since midnight, or null when no clock time is present.
 */
export function slotStartMinutes(value) {
  const match = String(value ?? "").match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour < 1 || hour > 12) return null;
  const minute = Number(match[2] ?? 0);
  const hour24 = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return hour24 * 60 + minute;
}

/**
 * Recognizes the pre-dawn Alpine Start departures (roughly midnight through
 * 4:59 a.m.) either by an explicit "Alpine" product name or by an early AM
 * clock time, regardless of the exact label the site uses.
 */
export function isAlpineSlotLabel(value) {
  const label = String(value ?? "");
  if (/alpine/i.test(label)) return true;
  const minutes = slotStartMinutes(label);
  if (minutes === null) return false;
  return minutes < 5 * 60;
}

export function shouldAutoHold(config = {}, flags = {}) {
  return (
    flags.dryRun !== true &&
    flags.noHold !== true &&
    config.autoHold !== false
  );
}

export function validateAutomationConfig(config = {}) {
  const partySize = Number(config.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
    throw new Error("partySize must be an integer from 1 to 10.");
  }

  const categories = config.passengerCategories;
  if (categories != null) {
    const counts = Object.values(categories);
    if (
      counts.some((value) => !Number.isInteger(value) || value < 0) ||
      counts.reduce((sum, value) => sum + value, 0) !== partySize
    ) {
      throw new Error(
        "passengerCategories must contain non-negative integers that add up to partySize."
      );
    }
  }

  if (
    config.autoSubmitPurchase === true &&
    (!Number.isFinite(Number(config.maxPurchaseCAD)) ||
      Number(config.maxPurchaseCAD) <= 0)
  ) {
    throw new Error(
      "autoSubmitPurchase requires a positive maxPurchaseCAD safety cap."
    );
  }
  return true;
}

export function orderSlotLabels(labels, preferred = [], options = {}) {
  const preference = preferred.map(normalizeWindow);
  const alpineFirst = options.alpineFirst === true;
  return [...labels].sort((a, b) => {
    const aNormalized = normalizeWindow(a);
    const bNormalized = normalizeWindow(b);
    const aRank = preference.findIndex((p) => aNormalized.includes(p));
    const bRank = preference.findIndex((p) => bNormalized.includes(p));
    const safeA = aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank;
    const safeB = bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank;

    if (alpineFirst) {
      const aAlpine = isAlpineSlotLabel(a);
      const bAlpine = isAlpineSlotLabel(b);
      if (aAlpine !== bAlpine) return aAlpine ? -1 : 1;
      if (aAlpine && bAlpine) {
        const aMinutes = slotStartMinutes(a) ?? Number.MAX_SAFE_INTEGER;
        const bMinutes = slotStartMinutes(b) ?? Number.MAX_SAFE_INTEGER;
        return aMinutes - bMinutes || safeA - safeB || a.localeCompare(b);
      }
    }

    return safeA - safeB || a.localeCompare(b);
  });
}

export function findMoraineAvailability(matrix, dateHeader) {
  if (!Array.isArray(matrix) || matrix.length < 2) return null;
  const header = matrix[0];
  const column = header.findIndex((cell) => cell.text === dateHeader);
  if (column < 1) return null;

  const candidates = matrix
    .slice(1)
    .map((row, index) => ({ row, rowIndex: index + 1 }))
    .filter(({ row }) => /^Moraine Lake/i.test(row[0]?.text ?? ""))
    .sort((a, b) => {
      const aLastMinute = a.row[0].text.includes("(Last Minute)") ? 0 : 1;
      const bLastMinute = b.row[0].text.includes("(Last Minute)") ? 0 : 1;
      return aLastMinute - bLastMinute;
    });

  for (const candidate of candidates) {
    const cell = candidate.row[column];
    const status = `${cell?.aria ?? ""} ${cell?.classes ?? ""}`;
    if (/\bAvailable\b/i.test(status) && !/\bUnavailable\b/i.test(status)) {
      return {
        rowIndex: candidate.rowIndex,
        columnIndex: column,
        rowLabel: candidate.row[0].text,
        status
      };
    }
  }
  return null;
}

export function isFinalPurchaseAction(label) {
  const normalized = String(label ?? "").trim().replace(/\s+/g, " ");
  return /\b(pay now|submit payment|complete purchase|confirm and pay|place order|complete reservation|confirm reservation|book now)\b/i
    .test(normalized);
}

export function checkoutStageFrom(text, url = "") {
  const visibleText = String(text ?? "").replace(/\s+/g, " ");
  const location = String(url ?? "");
  const combined = `${location} ${visibleText}`;

  if (/\/create-booking\/payment(?:\/|$)/i.test(location)) return "payment";
  if (/\/cart(?:\/|$|\?)/i.test(location)) return "cart";
  if (/\/create-booking\/(reviewpolicies|contactinfo|permitholder|additionalinfo|partyinfo|addons|shipment-info|harborinformation)(?:\/|$|\?)/i.test(location)) {
    return "checkout";
  }
  if (/\b(payment|billing|credit card|cardholder|order summary|confirm and pay|pay now)\b/i.test(combined)) {
    return "payment";
  }
  if (/\b(checkout|passenger details|visitor details|reservation details|occupant details)\b/i.test(combined)) {
    return "checkout";
  }
  if (/\b(shopping cart|your cart|cart summary)\b/i.test(combined)) {
    return "cart";
  }
  return "unknown";
}
