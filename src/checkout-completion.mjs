import { DateTime } from "luxon";
import { checkoutStageFrom, isFinalPurchaseAction } from "./lib.mjs";

const INTERRUPTION_PATTERN =
  /captcha|verify you are human|unusual traffic|security check|you are now in line|estimated wait|virtual queue|queue-it|access denied|temporarily blocked/i;
const CONFIRMATION_PATTERN =
  /reservation (?:is )?confirmed|booking number|confirmation number|thank you for your reservation/i;
const NEXT_ACTION_PATTERN =
  /^(?:continue|next|proceed(?: to (?:payment|review))?|review(?: reservation)?|save and continue)$/i;

function compact(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function parseTotalCad(text) {
  const values = [];
  const pattern =
    /(?:grand total|order total|reservation total|total|amount due)[^$\d]{0,30}(?:CAD\s*)?\$\s*([0-9,]+\.\d{2})/gi;
  let match;
  while ((match = pattern.exec(String(text ?? ""))) !== null) {
    values.push(Number(match[1].replace(/,/g, "")));
  }
  return values.filter(Number.isFinite).at(-1) ?? null;
}

export function targetDateAppears(text, targetDate) {
  const date = DateTime.fromISO(targetDate, { zone: "America/Edmonton" });
  if (!date.isValid) return false;
  const normalized = compact(text).toLowerCase();
  return [
    date.toFormat("yyyy-LL-dd"),
    date.toFormat("LLLL d, yyyy"),
    date.toFormat("LLL d, yyyy"),
    date.toFormat("cccc, LLLL d"),
    date.toFormat("ccc, LLL d")
  ].some((candidate) => normalized.includes(candidate.toLowerCase()));
}

async function clickRequiredAcknowledgements(page) {
  const checkboxes = page.locator(
    'input[type="checkbox"][required], input[type="checkbox"][aria-required="true"], [role="checkbox"][aria-required="true"]'
  );
  const count = await checkboxes.count().catch(() => 0);
  let changed = false;
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (!(await checkbox.isVisible().catch(() => false))) continue;
    const alreadyChecked = typeof checkbox.isChecked === "function"
      ? await checkbox.isChecked().catch(() => false)
      : (await checkbox.getAttribute("aria-checked").catch(() => "")) === "true";
    if (alreadyChecked) continue;
    if (typeof checkbox.check === "function") {
      await checkbox.check().catch(() => checkbox.click());
    } else {
      await checkbox.click();
    }
    changed = true;
  }
  return changed;
}

async function fillPassengerCategories(page, categories = {}) {
  if (typeof page.getByRole !== "function") return false;
  const definitions = [
    ["adult", /\badult\b/i],
    ["senior", /\bsenior\b/i],
    ["youth", /\b(youth|teen)\b/i],
    ["child", /\bchild\b/i],
    ["infant", /\binfant\b/i]
  ];
  let changed = false;
  for (const [key, name] of definitions) {
    const value = categories[key];
    if (!Number.isInteger(value) || value < 0) continue;
    const field = page.getByRole("spinbutton", { name }).first();
    if (
      !(await field.isVisible().catch(() => false)) ||
      !(await field.isEnabled().catch(() => false))
    ) {
      continue;
    }
    const current = await field.inputValue().catch(() => "");
    if (current === String(value)) continue;
    await field.fill(String(value));
    changed = true;
  }
  return changed;
}

async function visibleButtons(page) {
  const buttons = page.locator('button:visible, [role="button"]:visible');
  const count = await buttons.count().catch(() => 0);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isEnabled().catch(() => false))) continue;
    const label = compact(
      await button.innerText().catch(
        () => button.getAttribute("aria-label").catch(() => "")
      )
    );
    if (label) results.push({ button, label });
  }
  return results;
}

async function waitForConfirmation(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (CONFIRMATION_PATTERN.test(text)) return text;
    if (INTERRUPTION_PATTERN.test(text)) return null;
    await page.waitForTimeout(100);
  }
  return null;
}

/**
 * Continue through checkout pages that are already satisfied by the user's
 * Parks Canada profile. No payment secret is read or stored. A final purchase
 * is submitted only under an explicit configuration flag and after itinerary
 * and total validation.
 */
export async function completeCheckout(page, options = {}) {
  const targetDate = options.targetDate;
  const maxTotalCad = Number(options.maxTotalCad);
  const autoSubmitPurchase = options.autoSubmitPurchase === true;
  const maxSteps = Math.max(1, Number(options.maxSteps) || 10);
  const visited = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const stage = checkoutStageFrom(bodyText, page.url());
    visited.push({ url: page.url(), stage });

    if (CONFIRMATION_PATTERN.test(bodyText)) {
      return {
        completed: true,
        purchased: true,
        purchaseMayExist: false,
        stage: "confirmation",
        reason: "reservation-confirmed",
        visited
      };
    }
    if (INTERRUPTION_PATTERN.test(bodyText)) {
      return {
        completed: false,
        purchased: false,
        stage,
        reason: "human-verification-required",
        visited
      };
    }

    await fillPassengerCategories(page, options.passengerCategories);
    await clickRequiredAcknowledgements(page);

    const buttons = await visibleButtons(page);
    const finalAction = buttons.find(({ label }) => isFinalPurchaseAction(label));
    if (finalAction) {
      if (!autoSubmitPurchase) {
        return {
          completed: false,
          purchased: false,
          stage: "payment",
          reason: "final-confirmation-required",
          totalCad: parseTotalCad(bodyText),
          visited
        };
      }

      const totalCad = parseTotalCad(bodyText);
      if (!targetDateAppears(bodyText, targetDate)) {
        return {
          completed: false,
          purchased: false,
          stage: "payment",
          reason: "target-date-not-confirmed",
          totalCad,
          visited
        };
      }
      if (!/\bMoraine Lake\b/i.test(bodyText)) {
        return {
          completed: false,
          purchased: false,
          stage: "payment",
          reason: "destination-not-confirmed",
          totalCad,
          visited
        };
      }
      if (
        !Number.isFinite(totalCad) ||
        !Number.isFinite(maxTotalCad) ||
        totalCad <= 0 ||
        totalCad > maxTotalCad
      ) {
        return {
          completed: false,
          purchased: false,
          stage: "payment",
          reason: "purchase-total-not-approved",
          totalCad,
          visited
        };
      }

      console.log(
        `Checkout flow: submitting approved final reservation for CAD $${totalCad.toFixed(2)}.`
      );
      await finalAction.button.click();
      const confirmationText = await waitForConfirmation(
        page,
        options.confirmationTimeout ?? 90_000
      );
      return {
        completed: Boolean(confirmationText),
        purchased: Boolean(confirmationText),
        purchaseMayExist: !confirmationText,
        stage: confirmationText ? "confirmation" : "payment",
        reason: confirmationText
          ? "reservation-confirmed"
          : "final-action-result-ambiguous",
        totalCad,
        visited
      };
    }

    const nextAction = buttons.find(({ label }) => NEXT_ACTION_PATTERN.test(label));
    if (!nextAction) {
      return {
        completed: false,
        purchased: false,
        stage,
        reason: stage === "payment"
          ? "payment-details-required"
          : "checkout-input-required",
        totalCad: parseTotalCad(bodyText),
        visited
      };
    }

    const beforeUrl = page.url();
    console.log(`Checkout flow: clicked checkout step (${nextAction.label})`);
    await nextAction.button.click();
    await page.waitForURL((url) => url.toString() !== beforeUrl, {
      timeout: options.navigationTimeout ?? 20_000
    }).catch(() => {});
    await page.waitForTimeout(100);
  }

  return {
    completed: false,
    purchased: false,
    stage: checkoutStageFrom(
      await page.locator("body").innerText().catch(() => ""),
      page.url()
    ),
    reason: "checkout-step-limit",
    visited
  };
}
