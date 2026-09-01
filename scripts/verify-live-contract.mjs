#!/usr/bin/env node

const HOME_URL = "https://reservation.pc.gc.ca/";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36";

async function fetchText(path) {
  const url = new URL(path, HOME_URL);
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  }
  if (/azure waf|verify you are human|captcha/i.test(text)) {
    throw new Error(`${url.pathname} returned a human-verification challenge.`);
  }
  return text;
}

async function fetchJson(path) {
  const url = new URL(path, HOME_URL);
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function extractAsset(text, expression, description) {
  const match = text.match(expression);
  if (!match) throw new Error(`Could not locate the current ${description} asset.`);
  return match[1];
}

function requireMarker(text, marker, description) {
  if (!text.includes(marker)) {
    throw new Error(`Live contract changed: ${description} is missing.`);
  }
  console.log(`✓ ${description}`);
}

function requireOneOf(text, markers, description) {
  if (!markers.some((marker) => text.includes(marker))) {
    throw new Error(`Live contract changed: ${description} is missing.`);
  }
  console.log(`✓ ${description}`);
}

async function main() {
  console.log("Checking the current Parks Canada public booking application...");
  const home = await fetchText("/");
  const mainAsset = extractAsset(
    home,
    /(main-[A-Z0-9]+\.js)/,
    "main application"
  );
  const main = await fetchText(mainAsset);

  const createBookingAsset = extractAsset(
    main,
    /path:"create-booking".{0,180}?import\("\.\/(chunk-[A-Z0-9]+\.js)"\)/,
    "create-booking"
  );
  const cartAsset = extractAsset(
    main,
    /path:"cart".{0,180}?import\("\.\/(chunk-[A-Z0-9]+\.js)"\)/,
    "shopping-cart"
  );
  const createBooking = await fetchText(createBookingAsset);
  const resultsAsset = extractAsset(
    createBooking,
    /path:"results".{0,180}?import\("\.\/(chunk-[A-Z0-9]+\.js)"\)/,
    "search-results"
  );
  const [results, cart] = await Promise.all([
    fetchText(resultsAsset),
    fetchText(cartAsset)
  ]);

  requireMarker(results, "mapLink-button-", "time-window result buttons");
  requireMarker(results, '"id","map-back-button"', "map back button");
  requireMarker(results, "mat-button-toggle-group", "results view toggle");
  requireMarker(results, "app-list-view", "accessible List-view component");
  requireMarker(results, "data-e2e-date", "exact-date cells");
  requireOneOf(
    results,
    [
      '"id","reserveButton"',
      '"id","reserveButtonMulti"',
      '"id","reserveButtonGridView"'
    ],
    "Reserve control"
  );
  requireMarker(results, '"id","proceedToCartButton"', "Proceed-to-cart button");
  requireMarker(cart, '"id","proceedToCheckout"', "cart Checkout button");
  requireMarker(createBooking, 'path:"reviewpolicies"', "policy-review route");
  requireMarker(createBooking, 'path:"contactinfo"', "contact-information route");
  requireMarker(createBooking, 'path:"partyinfo"', "passenger-information route");
  requireMarker(
    createBooking,
    'path:"payment/:redirectUrl"',
    "payment route after checkout"
  );

  const serverClock = await fetchJson("/api/transactionlocation/servertime");
  if (!Number.isFinite(Date.parse(serverClock))) {
    throw new Error("Live contract changed: official server clock is invalid.");
  }
  console.log("✓ official server clock endpoint");

  console.log("Live booking contract verified.");
}

main().catch((error) => {
  console.error(`Live contract check failed: ${error.message}`);
  process.exitCode = 1;
});
