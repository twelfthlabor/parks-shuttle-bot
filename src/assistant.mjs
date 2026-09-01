#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { DateTime } from "luxon";
import {
  advanceReleaseToCheckout,
  advanceToCheckout,
  checkoutStageMessage
} from "./checkout-flow.mjs";
import { completeCheckout } from "./checkout-completion.mjs";
import { installDomStatusMonitor } from "./dom-status-monitor.mjs";
import { recordTerminalState } from "./terminal-state.mjs";
import {
  HOME_URL,
  PARK_TIME_ZONE,
  buildSearchUrl,
  findMoraineAvailability,
  isAvailableSlotLabel,
  orderSlotLabels,
  releaseTimeFor,
  shouldAutoHold,
  slotLabelKey,
  targetDateHeader,
  validateAutomationConfig,
  validateDate
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = path.join(projectRoot, ".browser-profile");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function persistTerminalState(date, outcome, details) {
  let terminalState;
  try {
    terminalState = recordTerminalState(date, outcome, details);
  } catch (primaryError) {
    console.error(
      `Could not write the durable terminal state: ${primaryError.message}. ` +
      "Using the /tmp safety fallback."
    );
    terminalState = recordTerminalState(
      date,
      outcome,
      details,
      { baseDir: "/tmp" }
    );
  }
  console.log(
    `Terminal booking state: ${terminalState.payload.outcome} ` +
    `(${terminalState.filePath})`
  );
}

function parseArguments(argv) {
  const result = {
    setup: false,
    watch: false,
    now: false,
    dryRun: false,
    checkoutTest: false,
    preflight: false,
    noHold: false,
    date: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--setup") result.setup = true;
    else if (value === "--watch") result.watch = true;
    else if (value === "--now") result.now = true;
    else if (value === "--dry-run") result.dryRun = true;
    else if (value === "--checkout-test") {
      result.checkoutTest = true;
      result.now = true;
    }
    else if (value === "--preflight") {
      result.preflight = true;
      result.now = true;
      result.noHold = true;
    }
    else if (value === "--no-hold") result.noHold = true;
    else if (value === "--date") result.date = argv[++i];
    else if (value === "--help" || value === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function loadConfig() {
  const userConfig = path.join(projectRoot, "config.json");
  const exampleConfig = path.join(projectRoot, "config.example.json");
  const configPath = existsSync(userConfig) ? userConfig : exampleConfig;
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function usage() {
  console.log(`
Parks Shuttle Bot

First-time setup:
  npm run setup

Run for the official 8:00 a.m. MT release:
  npm run run -- --date 2026-09-15

Watch for cancellations after release:
  npm run watch -- --date 2026-09-15

Safe live-flow test (will not hold seats):
  npm run dry-run -- --date 2026-09-15

Release preflight (selects the exact cell but never clicks Reserve):
  npm run preflight -- --date 2026-09-15

Checkout rehearsal (creates a temporary hold, never submits payment):
  npm run checkout-test -- --date 2026-09-15

Options:
  --now       Skip the release-time wait
  --no-hold   Alert on availability but do not click the exact date cell
  --dry-run   Same as --no-hold, with extra diagnostic output
  --preflight Open and preselect the exact date cell, but never click Reserve
  --checkout-test
              Hold available seats now and advance only to checkout
`);
}

async function notify(title, message, speak = false) {
  console.log(`\n${title}: ${message}\n`);
  if (process.platform !== "darwin") return;
  const safeTitle = title.replace(/["\\]/g, "");
  const safeMessage = message.replace(/["\\]/g, "");
  await execFileAsync("osascript", [
    "-e",
    `display notification "${safeMessage}" with title "${safeTitle}" sound name "Glass"`
  ]).catch(() => {});
  if (speak) {
    await execFileAsync("say", [`${safeTitle}. ${safeMessage}`]).catch(() => {});
  }
}

async function launchBrowser() {
  const options = {
    headless: false,
    viewport: { width: 1280, height: 850 },
    args: ["--disable-background-timer-throttling"]
  };
  if (existsSync(chromePath)) options.executablePath = chromePath;
  return chromium.launchPersistentContext(profileDir, options);
}

async function acceptCookies(page) {
  const consent = page.getByRole("button", { name: "I Consent", exact: true });
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

async function isSignedOut(page) {
  const signIn = page.locator("#login");
  if (!(await signIn.isVisible().catch(() => false))) return false;
  return /sign in/i.test((await signIn.innerText().catch(() => "")) || "");
}

async function setupProfile() {
  const context = await launchBrowser();
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  await page.bringToFront();
  await notify(
    "Setup needed",
    "Sign in and complete your Parks Canada contact and payment profile. Keep payment data in Parks Canada or Chrome secure storage, never config.json.",
    true
  );

  if (process.stdin.isTTY) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question("After Parks Canada shows you as signed in, press Enter here...");
    prompt.close();
  } else {
    console.log("Close the Chrome window after signing in.");
    await page.waitForEvent("close", { timeout: 30 * 60 * 1000 }).catch(() => {});
  }

  const signedOut = await isSignedOut(page).catch(() => true);
  if (signedOut) {
    await notify("Setup not confirmed", "The profile still appears signed out. Run npm run setup again.");
    await context.close();
    process.exitCode = 1;
    return;
  }
  await notify("Setup complete", "The signed-in browser profile is ready.");
  await context.close();
}

async function waitUntil(target, label) {
  let lastPrintedMinute = null;
  while (DateTime.now().toMillis() < target.toMillis()) {
    const remaining = target.toMillis() - DateTime.now().toMillis();
    const minute = Math.ceil(remaining / 60_000);
    if (minute !== lastPrintedMinute && (minute <= 10 || minute % 15 === 0)) {
      console.log(`${label}: ${minute} minute${minute === 1 ? "" : "s"} remaining`);
      lastPrintedMinute = minute;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(25, remaining))));
  }
}

async function calibrateServerClock(context, sampleCount = 3) {
  const samples = [];
  for (let i = 0; i < sampleCount; i += 1) {
    try {
      const localStart = Date.now();
      const response = await context.request.get(
        new URL("/api/transactionlocation/servertime", HOME_URL).toString()
      );
      const serverTime = Date.parse(await response.json());
      const localEnd = Date.now();
      if (!response.ok() || !Number.isFinite(serverTime)) continue;
      samples.push({
        roundTripMs: localEnd - localStart,
        offsetMs: serverTime - (localStart + localEnd) / 2
      });
    } catch {
      // The Mac clock remains the safe fallback if the calibration endpoint is unavailable.
    }
  }
  if (samples.length === 0) return { offsetMs: 0, roundTripMs: null };
  return samples.sort((a, b) => a.roundTripMs - b.roundTripMs)[0];
}

async function waitUntilEpoch(targetEpochMs, label) {
  let lastPrintedMinute = null;
  while (Date.now() < targetEpochMs) {
    const remaining = targetEpochMs - Date.now();
    const minute = Math.ceil(remaining / 60_000);
    if (minute !== lastPrintedMinute && (minute <= 10 || minute % 15 === 0)) {
      console.log(`${label}: ${minute} minute${minute === 1 ? "" : "s"} remaining`);
      lastPrintedMinute = minute;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(10, remaining))));
  }
}

async function waitForSignIn(page, deadline) {
  if (!(await isSignedOut(page))) return true;
  await page.bringToFront();
  await notify(
    "Parks Canada sign-in required",
    "Sign in now in the open Chrome window. The assistant will continue automatically.",
    true
  );
  while (DateTime.now().toMillis() < deadline.toMillis()) {
    if (!(await isSignedOut(page))) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return !(await isSignedOut(page));
}

async function extractAvailabilityMatrix(table) {
  return table.evaluate((element) =>
    Array.from(element.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => ({
        text: (cell.textContent || "").trim().replace(/\s+/g, " "),
        aria: cell.getAttribute("aria-label") || "",
        classes: typeof cell.className === "string" ? cell.className : ""
      }))
    )
  );
}

async function waitForExactDateAvailability(table, date, timeout = 500) {
  const availableCell = table
    .locator(
      `td[data-e2e-date="${date}"][aria-label*="Available"]` +
      `:not([aria-label*="Unavailable"])`
    )
    .first();
  await availableCell.waitFor({ state: "attached", timeout }).catch(() => {});
}

async function openListView(page) {
  const roleListButton = page.getByRole("button", { name: /\blist\b/i }).first();
  let listButton = null;

  await roleListButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (await roleListButton.isVisible().catch(() => false)) {
    listButton = roleListButton;
  }
  if (!listButton) {
    const toggleButtons = page.locator(
      'mat-button-toggle button, button[name^="mat-button-toggle-group"]'
    );
    await toggleButtons.first().waitFor({ state: "visible", timeout: 20_000 });
    const count = await toggleButtons.count();
    for (let i = 0; i < count; i += 1) {
      const button = toggleButtons.nth(i);
      const label = `${await button.getAttribute("aria-label") ?? ""} ${await button.innerText()}`;
      if (/\blist\b/i.test(label)) {
        listButton = button;
        break;
      }
    }
  }
  if (!listButton) throw new Error("The results page did not expose a List-view button.");
  await listButton.click();
  const slotButtons = page.locator('button[id^="mapLink-button-"]');
  await slotButtons.first().waitFor({
    state: "visible",
    timeout: 20_000
  });
  await slotButtons.filter({ hasText: /\bTime Slot\b/i }).first().waitFor({
    state: "visible",
    timeout: 10_000
  });
}

async function armPreferredSlot(page, date, config) {
  await openListView(page);
  const slotButtons = page.locator('button[id^="mapLink-button-"]');
  const rawLabels = (await slotButtons.allTextContents())
    .map((text) => text.trim().replace(/\s+/g, " "))
    .filter(isAvailableSlotLabel);
  const ordered = orderSlotLabels(rawLabels, config.preferredDepartureWindows);
  if (ordered.length === 0) return null;

  const firstCandidate = ordered[0];
  for (const preferredLabel of ordered) {
    const currentButtons = page.locator('button[id^="mapLink-button-"]');
    const count = await currentButtons.count();
    let selected = null;
    for (let i = 0; i < count; i += 1) {
      const button = currentButtons.nth(i);
      const text = (await button.innerText()).trim().replace(/\s+/g, " ");
      if (slotLabelKey(text) === slotLabelKey(preferredLabel)) {
        selected = button;
        break;
      }
    }
    if (!selected) continue;

    await selected.click();
    await page.locator("table").filter({ hasText: "Moraine Lake:" }).first().waitFor({
      state: "visible",
      timeout: 20_000
    });
    const table = page.locator("table").filter({ hasText: "Moraine Lake:" }).first();
    await waitForExactDateAvailability(table, date, 10_000);
    const matrix = await extractAvailabilityMatrix(table);
    const match = findMoraineAvailability(matrix, targetDateHeader(date));
    if (!match) {
      if (!(await returnToWindowList(page))) break;
      continue;
    }

    const targetCell = table
      .locator("tr")
      .nth(match.rowIndex)
      .locator("td")
      .nth(match.columnIndex);
    await targetCell.click();
    const reserve = page
      .locator(
        "#reserveButton:visible, #reserveButtonMulti:visible, #reserveButtonGridView:visible"
      )
      .first();
    await reserve.waitFor({ state: "visible", timeout: 10_000 });
    await reserve.click({ trial: true, timeout: 5_000 });
    return {
      label: preferredLabel,
      preselected: true,
      slotName: match.rowLabel.replace(/^Moraine Lake:\s*/, "")
    };
  }
  return { label: firstCandidate, preselected: false, slotName: null };
}

async function detectInterruption(page) {
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const visibleText = `${title} ${bodyText}`;
  if (/reserving these dates is not yet allowed|cannot be reserved until/i.test(visibleText)) {
    return "release-not-open";
  }
  if (/captcha|verify you are human|unusual traffic|azure waf|security check/i.test(visibleText)) {
    return "Parks Canada requires a human verification. Complete it in the open browser.";
  }
  if (/you are now in line|estimated wait|virtual queue|queue-it/i.test(visibleText)) {
    return "Parks Canada placed this browser in its queue. Keep the browser open and follow the queue.";
  }
  if (/access denied|temporarily blocked/i.test(visibleText)) {
    return "Parks Canada blocked this automated attempt. Stop retrying and use the site manually.";
  }
  return null;
}

async function returnToWindowList(page) {
  const back = page
    .locator(
      '#map-back-button:visible, #map-back-button_mobile:visible, button[aria-label="View previous map"]:visible'
    )
    .first();
  if (!(await back.isVisible().catch(() => false))) return false;
  await back.click();
  await openListView(page);
  return true;
}

function checkoutCompletionMessage(completion) {
  if (completion?.reason === "final-action-result-ambiguous") {
    return (
      "The final purchase was submitted but Parks Canada did not show a " +
      "confirmation in time. Do not submit again. Check the Parks Canada " +
      "account and card activity, then take over in Chrome."
    );
  }
  return `Checkout automation stopped safely: ${completion?.reason}. Take over now.`;
}

async function inspectAndMaybeHold(page, date, config, flags, armedSlotLabel = null) {
  const interruption = await detectInterruption(page);
  if (interruption === "release-not-open") {
    console.log("Parks Canada release gate is still active; retrying the armed exact-date page.");
    return { status: "unavailable", reason: "release-not-open" };
  }
  if (interruption) {
    await page.bringToFront();
    await notify("Your action is needed", interruption, true);
    return { status: "handoff" };
  }

  if (await isSignedOut(page) && !flags.dryRun) {
    await page.bringToFront();
    await notify("Your action is needed", "Sign in to Parks Canada, then rerun the command.", true);
    return { status: "handoff" };
  }

  let slotButtons = null;
  let ordered = [];
  if (armedSlotLabel) {
    ordered = [armedSlotLabel];
  } else {
    await openListView(page);
    slotButtons = page.locator('button[id^="mapLink-button-"]');
    const allLabels = (await slotButtons.allTextContents())
      .map((text) => text.trim().replace(/\s+/g, " "))
    if (flags.dryRun) console.log("Live window controls:", allLabels);
    const rawLabels = allLabels
      .filter(isAvailableSlotLabel);
    ordered = orderSlotLabels(rawLabels, config.preferredDepartureWindows);
  }
  if (flags.dryRun) console.log("Candidate windows:", ordered);
  if (ordered.length === 0) return { status: "unavailable" };

  for (const label of ordered) {
    if (!armedSlotLabel) {
      const currentButtons = page.locator('button[id^="mapLink-button-"]');
      const count = await currentButtons.count();
      let selected = null;
      for (let i = 0; i < count; i += 1) {
        const button = currentButtons.nth(i);
        const text = (await button.innerText()).trim().replace(/\s+/g, " ");
        if (slotLabelKey(text) === slotLabelKey(label)) {
          selected = button;
          break;
        }
      }
      if (!selected) continue;
      await selected.click();
    }

    const table = page.locator("table").filter({ hasText: "Moraine Lake:" }).first();
    await table.waitFor({ state: "visible", timeout: 20_000 });
    await waitForExactDateAvailability(table, date, 750);
    const matrix = await extractAvailabilityMatrix(table);
    const match = findMoraineAvailability(matrix, targetDateHeader(date));

    if (flags.dryRun) {
      console.log(`${label}:`, match ?? "not available for the exact date");
    }

    if (match) {
      const detectedAt = Date.now();
      const slotName = match.rowLabel.replace(/^Moraine Lake:\s*/, "");
      if (flags.releaseEpochMs && detectedAt >= flags.releaseEpochMs) {
        console.log(
          `Timing: exact availability detected ${Math.max(0, detectedAt - flags.releaseEpochMs)} ms after release.`
        );
      }
      if (!shouldAutoHold(config, flags)) {
        await page.bringToFront();
        await notify(
          "Two Moraine Lake seats found",
          `${date}, ${slotName}. Select the green date cell immediately.`,
          true
        );
        return { status: "found", held: false, slotName };
      }

      const targetCell = table
        .locator("tr")
        .nth(match.rowIndex)
        .locator("td")
        .nth(match.columnIndex);
      await targetCell.click();

      let checkoutResult = null;
      if (config.autoProceedToCheckout || flags.checkoutTest) {
        checkoutResult = await advanceReleaseToCheckout(page, {
          reserveTimeout: 3_000,
          outcomeTimeout: Math.max(
            1_500,
            Number(config.releaseOutcomeTimeoutMilliseconds) || 5_000
          ),
          holdTimeout: 7_500,
          retryWindow: 1_750,
          retryInterval: Math.max(
            100,
            Number(config.releaseRetryIntervalMilliseconds) || 150
          )
        });
        if (checkoutResult?.timing) {
          console.log(
            `Timing: availability-to-checkout ${checkoutResult.timing.totalMs} ms ` +
            `(hold ${checkoutResult.timing.holdConfirmedMs ?? "n/a"} ms, ` +
            `cart ${checkoutResult.timing.cartOpenedMs ?? "n/a"} ms).`
          );
        }
      }

      if (
        checkoutResult?.reason === "release-not-open" ||
        checkoutResult?.reason === "not-enough-availability"
      ) {
        console.log(
          `${slotName}: Parks Canada confirmed that this attempt did not create a hold.`
        );
        if (armedSlotLabel || !(await returnToWindowList(page))) {
          return { status: "unavailable", reason: checkoutResult.reason };
        }
        continue;
      }

      if (checkoutResult?.holdMayExist) {
        await page.bringToFront();
        await notify(
          "Take over now",
          `${date}, ${slotName}. Reserve was sent but the hold state is ambiguous.`,
          true
        );
        return { status: "handoff", checkout: checkoutResult };
      }

      if (checkoutResult?.advanced && config.autoPrepareCheckout !== false) {
        checkoutResult.completion = await completeCheckout(page, {
          targetDate: date,
          passengerCategories: config.passengerCategories,
          autoSubmitPurchase:
            config.autoSubmitPurchase === true && !flags.checkoutTest,
          maxTotalCad: config.maxPurchaseCAD
        });
      }

      await page.bringToFront();
      await notify(
        checkoutResult?.completion?.purchased
          ? "Reservation confirmed"
          : checkoutResult?.advanced
            ? "Checkout ready"
            : "Seats selected",
        `${date}, ${slotName}. ${
          checkoutResult?.completion?.purchased
            ? "Parks Canada confirmed the reservation. Verify the booking number and confirmation email."
            : checkoutResult?.completion
              ? checkoutCompletionMessage(checkoutResult.completion)
              : checkoutResult
            ? checkoutStageMessage(checkoutResult)
            : "The date is selected. Complete the cart and checkout manually."
        }`,
        true
      );
      return {
        status: "found",
        held: checkoutResult?.held === true,
        slotName,
        checkout: checkoutResult
      };
    }

    if (armedSlotLabel) return { status: "unavailable" };

    if (!(await returnToWindowList(page))) {
      break;
    }
  }
  return { status: "unavailable" };
}

async function reservePreselectedSlot(page, date, armedSlot, config) {
  console.log(`Timing: clicking pre-armed Reserve ${Date.now()} epoch ms.`);
  const checkoutResult = await advanceReleaseToCheckout(page, {
    reserveTimeout: 3_000,
    outcomeTimeout: Math.max(
      1_500,
      Number(config.releaseOutcomeTimeoutMilliseconds) || 5_000
    ),
    holdTimeout: 7_500,
    retryWindow: Math.max(
      1_000,
      (Number(config.releaseRetryWindowSeconds) || 10) * 1000
    ),
    retryInterval: Math.max(
      100,
      Number(config.releaseRetryIntervalMilliseconds) || 150
    )
  });
  if (checkoutResult?.timing) {
    console.log(
      `Timing: release-to-checkout ${checkoutResult.timing.totalMs} ms ` +
      `(Reserve ${checkoutResult.timing.firstReserveClickedMs ??
        checkoutResult.timing.reserveClickedMs ?? "n/a"} ms, ` +
      `hold ${checkoutResult.timing.holdConfirmedMs ?? "n/a"} ms, ` +
      `cart ${checkoutResult.timing.cartOpenedMs ?? "n/a"} ms).`
    );
  }

  if (checkoutResult.advanced || checkoutResult.held) {
    if (checkoutResult.advanced && config.autoPrepareCheckout !== false) {
      checkoutResult.completion = await completeCheckout(page, {
        targetDate: date,
        passengerCategories: config.passengerCategories,
        autoSubmitPurchase: config.autoSubmitPurchase === true,
        maxTotalCad: config.maxPurchaseCAD
      });
    }
    await page.bringToFront();
    await notify(
      checkoutResult.completion?.purchased
        ? "Reservation confirmed"
        : checkoutResult.advanced
          ? "Checkout ready"
          : "Seats selected",
      `${date}, ${armedSlot.slotName}. ${
        checkoutResult.completion?.purchased
          ? "Parks Canada confirmed the reservation. Verify the booking number and confirmation email."
          : checkoutResult.completion
            ? checkoutCompletionMessage(checkoutResult.completion)
            : checkoutStageMessage(checkoutResult)
      }`,
      true
    );
    return {
      status: "found",
      held: checkoutResult.held === true,
      slotName: armedSlot.slotName,
      checkout: checkoutResult
    };
  }

  if (
    checkoutResult.reason === "release-not-open" ||
    checkoutResult.reason === "not-enough-availability"
  ) {
    return { status: "unavailable", reason: checkoutResult.reason };
  }

  if (checkoutResult.holdMayExist) {
    await page.bringToFront();
    await notify(
      "Take over now",
      `${date}, ${armedSlot.slotName}. Reserve was sent but the hold was not confirmed.`,
      true
    );
    return { status: "handoff", checkout: checkoutResult };
  }

  return { status: "unavailable", reason: checkoutResult.reason };
}

async function prepareManualReserveHandoff(page) {
  const reserve = page
    .locator(
      "#reserveButton:visible, #reserveButtonMulti:visible, #reserveButtonGridView:visible"
    )
    .first();
  await reserve.scrollIntoViewIfNeeded({ timeout: 5_000 });
  await reserve.hover({ timeout: 5_000 });
  console.log("Manual handoff: mouse positioned over the ready Reserve control.");
}

async function runAssistant(date, config, flags) {
  validateDate(date);
  const release = releaseTimeFor(date);
  const preloadLeadMs = Math.max(
    5_000,
    (Number(config.preloadLeadSeconds) || 30) * 1000
  );
  const releaseOffsetMs = Math.max(0, Number(config.releaseOffsetMilliseconds) || 0);
  const clockCalibrationLeadMs = Math.max(
    2_000,
    (Number(config.clockCalibrationLeadSeconds) || 10) * 1000
  );
  const clockCalibrationSamples = Math.min(
    7,
    Math.max(3, Math.trunc(Number(config.clockCalibrationSamples) || 5))
  );
  flags.releaseEpochMs = release.toMillis();
  console.log(`Target: ${date} for ${config.partySize} people`);
  console.log(`Official 60% release: ${release.toFormat("cccc, LLLL d 'at' h:mm:ss a ZZZZ")}`);

  const context = await launchBrowser();
  const domJournal = await installDomStatusMonitor(context, {
    outputDir: path.join(projectRoot, "output", "playwright"),
    targetDate: date
  });
  console.log(`DOM status journal: ${domJournal.filePath}`);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await acceptCookies(page);

  const signInDeadline = flags.now
    ? DateTime.now().plus({ minutes: 15 })
    : release.minus({ seconds: 5 });
  if (!flags.dryRun && !(await waitForSignIn(page, signInDeadline))) {
    persistTerminalState(date, "human-intervention", {
      reason: "signed-out-before-release"
    });
    await notify("Cannot continue", "The Parks Canada profile was not signed in before release.", true);
    await context.close();
    process.exitCode = 1;
    return;
  }

  if (flags.preflight) {
    await page.goto(buildSearchUrl(date, config.partySize), {
      waitUntil: "domcontentloaded"
    });
    await acceptCookies(page);
    const armedSlot = await armPreferredSlot(page, date, config);
    const serverClock = await calibrateServerClock(
      context,
      clockCalibrationSamples
    );
    console.log(
      `Parks Canada clock calibration: ${serverClock.offsetMs.toFixed(1)} ms offset ` +
      `(${serverClock.roundTripMs ?? "n/a"} ms round trip).`
    );
    if (!armedSlot?.preselected) {
      await notify(
        "Preflight failed",
        "The exact Moraine Lake last-minute cell could not be preselected.",
        true
      );
      await context.close();
      process.exitCode = 1;
      return;
    }
    await notify(
      "Preflight passed",
      `${date}, ${armedSlot.slotName}. The exact cell and Reserve control are ready; Reserve was not clicked.`,
      true
    );
    await context.close();
    return;
  }

  let armedSlot = null;
  let serverClock = { offsetMs: 0, roundTripMs: null };
  if (!flags.now && DateTime.now().setZone(PARK_TIME_ZONE) < release) {
    const preload = release.minus({ milliseconds: preloadLeadMs });
    await waitUntil(preload, "Preloading reservation results");
    await page.goto(buildSearchUrl(date, config.partySize), { waitUntil: "domcontentloaded" });
    await acceptCookies(page);
    if (
      !flags.dryRun &&
      !(await waitForSignIn(page, release.minus({ seconds: 15 })))
    ) {
      persistTerminalState(date, "human-intervention", {
        reason: "signed-out-during-release-preflight"
      });
      await notify(
        "Cannot continue",
        "The Parks Canada session expired before the release preflight.",
        true
      );
      await context.close();
      process.exitCode = 1;
      return;
    }
    armedSlot = await armPreferredSlot(page, date, config).catch((error) => {
      console.warn(`Could not pre-arm the preferred window: ${error.message}`);
      return null;
    });
    if (armedSlot) {
      console.log(
        `Pre-armed exact-date page: ${armedSlot.label}` +
        (armedSlot.preselected ? `; Reserve ready for ${armedSlot.slotName}.` : "")
      );
    }
    await waitUntil(
      release.minus({ milliseconds: clockCalibrationLeadMs }),
      "Calibrating Parks Canada server clock"
    );
    serverClock = await calibrateServerClock(context, clockCalibrationSamples);
    console.log(
      `Parks Canada clock calibration: ${serverClock.offsetMs.toFixed(1)} ms offset ` +
      `(${serverClock.roundTripMs ?? "n/a"} ms round trip).`
    );
    const localReleaseEpoch =
      release.toMillis() - serverClock.offsetMs + releaseOffsetMs;
    if (
      armedSlot?.preselected &&
      !shouldAutoHold(config, flags)
    ) {
      await waitUntilEpoch(
        localReleaseEpoch - 5_000,
        "Preparing manual Reserve handoff"
      );
      await page.bringToFront();
      await prepareManualReserveHandoff(page).catch((error) => {
        console.warn(`Could not position the mouse over Reserve: ${error.message}`);
      });
      await notify(
        "Reserve armed",
        `${date}, ${armedSlot.slotName}. Click Reserve when the Mountain Time clock reaches 8:00:00.`,
        true
      );
    }
    await waitUntilEpoch(localReleaseEpoch, "Waiting for the official release");
  }

  const watchStart = DateTime.now();
  const maxWatchMs = Math.max(1, Number(config.maxWatchMinutes) || 180) * 60_000;
  const releaseRetryWindowMs = Math.max(
    0,
    (Number(config.releaseRetryWindowSeconds) || 0) * 1000
  );
  const releaseRetryIntervalMs = Math.max(
    100,
    Number(config.releaseRetryIntervalMilliseconds) || 1_500
  );
  const releaseRecoveryMs = Math.max(
    0,
    Number(config.releaseRecoveryMinutes) || 0
  ) * 60_000;
  const recoveryPollMs = Math.max(
    15_000,
    (Number(config.releaseRecoveryPollSeconds) || 30) * 1000
  );
  const recoveryBurstStartMinutes = Math.max(
    0,
    Number(config.releaseRecoveryBurstStartMinutes) || 19
  );
  const recoveryBurstEndMinutes = Math.max(
    recoveryBurstStartMinutes,
    Number(config.releaseRecoveryBurstEndMinutes) || 30
  );
  const recoveryBurstStartMs = recoveryBurstStartMinutes * 60_000;
  const recoveryBurstEndMs = recoveryBurstEndMinutes * 60_000;
  const recoveryBurstPollMs = Math.max(
    5_000,
    (Number(config.releaseRecoveryBurstPollSeconds) || 10) * 1000
  );
  let attempt = 0;
  let retryArmedPage = Boolean(armedSlot && !armedSlot.preselected);
  let recoveryAnnounced = false;

  while (true) {
    attempt += 1;
    console.log(`Availability attempt ${attempt} at ${DateTime.now().setZone(PARK_TIME_ZONE).toFormat("HH:mm:ss ZZZZ")}`);
    let result = null;
    if (attempt === 1 && armedSlot?.preselected) {
      if (!shouldAutoHold(config, flags)) {
        await page.bringToFront();
        await notify(
          "Release open — click Reserve",
          `${date}, ${armedSlot.slotName}. The exact cell is selected and Reserve is ready.`,
          true
        );
        result = {
          status: "found",
          held: false,
          slotName: armedSlot.slotName
        };
      } else {
        result = await reservePreselectedSlot(page, date, armedSlot, config);
      }
    }

    const useArmedFastPath = result == null && retryArmedPage && armedSlot;
    if (result == null && useArmedFastPath) {
      await page.reload({ waitUntil: "domcontentloaded" });
    } else if (result == null) {
      await page.goto(buildSearchUrl(date, config.partySize), { waitUntil: "domcontentloaded" });
    }
    if (result == null) await acceptCookies(page);
    if (result == null) result = await inspectAndMaybeHold(
      page,
      date,
      config,
      flags,
      useArmedFastPath ? armedSlot.label : null
    ).catch(async (error) => {
      console.error("Availability check failed:", error.message);
      if (flags.dryRun) {
        const excerpt = (await page.locator("body").innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .slice(0, 800);
        console.error("Current URL:", page.url());
        console.error("Page excerpt:", excerpt);
      }
      const interruption = await detectInterruption(page);
      if (interruption === "release-not-open") {
        return { status: "unavailable", reason: "release-not-open" };
      }
      if (interruption) {
        await page.bringToFront();
        await notify("Your action is needed", interruption, true);
        return { status: "handoff" };
      }
      return { status: "error" };
    });
    retryArmedPage = useArmedFastPath && result.reason === "release-not-open";

    if (result.status === "found" || result.status === "handoff") {
      if (result.checkout?.completion?.purchased) {
        persistTerminalState(date, "confirmed", {
          slotName: result.slotName ?? null,
          held: result.held === true
        });
        console.log(
          "Parks Canada reported a confirmed reservation. Verify the booking number and confirmation email."
        );
      } else {
        persistTerminalState(date, "human-intervention", {
          slotName: result.slotName ?? null,
          held: result.held === true,
          reason:
            result.checkout?.completion?.reason ??
            result.checkout?.reason ??
            result.status
        });
        console.log("Leave the Chrome window open and finish manually.");
      }
      if (flags.dryRun) await context.close();
      return;
    }
    if (!flags.watch) {
      const stillInReleaseWindow = !flags.now &&
        DateTime.now().toMillis() < release.toMillis() + releaseRetryWindowMs;
      if (stillInReleaseWindow) {
        console.log(
          `No exact-date seats yet. Retrying in ${releaseRetryIntervalMs} ms during the release window.`
        );
        await new Promise((resolve) => setTimeout(resolve, releaseRetryIntervalMs));
        continue;
      }
      const nowMs = DateTime.now().toMillis();
      const recoveryDeadlineMs = release.toMillis() + releaseRecoveryMs;
      if (!flags.now && releaseRecoveryMs > 0 && nowMs < recoveryDeadlineMs) {
        if (!recoveryAnnounced) {
          recoveryAnnounced = true;
          await notify(
            "Watching returned cart holds",
            "The first release wave did not produce a hold. Monitoring all Moraine Lake windows through 9:00 a.m. Mountain.",
            true
          );
        }
        const elapsedFromReleaseMs = Math.max(0, nowMs - release.toMillis());
        const inCartExpiryBurst =
          elapsedFromReleaseMs >= recoveryBurstStartMs &&
          elapsedFromReleaseMs < recoveryBurstEndMs;
        const delayMs = inCartExpiryBurst ? recoveryBurstPollMs : recoveryPollMs;
        const jitterMs = Math.floor(Math.random() * 1_001);
        console.log(
          `No hold yet. Recovery scan in ${((delayMs + jitterMs) / 1000).toFixed(1)} seconds` +
          (inCartExpiryBurst ? " during the expected cart-expiry wave." : ".")
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs + jitterMs));
        continue;
      }
      await page.bringToFront();
      persistTerminalState(date, "recovery-exhausted", {
        partySize: config.partySize,
        recoveryMinutes: Number(config.releaseRecoveryMinutes) || 0
      });
      await notify(
        "No exact-date seats found",
        "Try the watch command for cancellations, or use Roam Transit/commercial shuttle backup options."
      );
      await context.close();
      return;
    }
    if (DateTime.now().toMillis() - watchStart.toMillis() >= maxWatchMs) {
      await notify("Watch ended", "No matching seats appeared during the configured watch period.");
      await context.close();
      return;
    }

    const base = Math.max(60, Number(config.pollSeconds) || 120);
    const jitter = Math.max(0, Number(config.pollJitterSeconds) || 0);
    const delaySeconds = base + Math.floor(Math.random() * (jitter + 1));
    console.log(`No exact-date seats. Checking again in ${delaySeconds} seconds.`);
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}

async function main() {
  try {
    const flags = parseArguments(process.argv.slice(2));
    if (flags.help) {
      usage();
      return;
    }
    if (flags.setup) {
      await setupProfile();
      return;
    }
    if (!flags.date) {
      usage();
      throw new Error("--date is required.");
    }
    const config = loadConfig();
    validateAutomationConfig(config);
    await runAssistant(flags.date, config, flags);
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
