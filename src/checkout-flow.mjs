import { checkoutStageFrom, isFinalPurchaseAction } from "./lib.mjs";

const RELEASE_GATE_PATTERN =
  /reserving these dates is not yet allowed|cannot be reserved until|not yet allowed/i;
const NO_INVENTORY_PATTERN =
  /not enough availability|insufficient availability|no longer available|is no longer available|could not be reserved|unable to reserve (?:the|these) selected/i;
const INTERRUPTION_PATTERN =
  /captcha|verify you are human|unusual traffic|azure waf|security check|you are now in line|estimated wait|virtual queue|queue-it|access denied|temporarily blocked/i;

async function waitForEnabled(page, locator, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  await locator.waitFor({ state: "visible", timeout }).catch(() => {});
  while (Date.now() < deadline) {
    if (
      await locator.isVisible().catch(() => false) &&
      await locator.isEnabled().catch(() => false)
    ) {
      return true;
    }
    await page.waitForTimeout(25);
  }
  return false;
}

async function clickSafeAction(locator, description) {
  const label = (await locator.innerText().catch(() => description))
    .trim()
    .replace(/\s+/g, " ");
  if (isFinalPurchaseAction(label)) {
    throw new Error(`Safety stop: refused to click final purchase action "${label}".`);
  }
  await locator.click();
  console.log(`Checkout flow: clicked ${description}${label ? ` (${label})` : ""}`);
}

async function waitForReleaseOutcome(page, timeout) {
  const proceedToCart = page.locator("#proceedToCartButton:visible").first();
  const deadline = Date.now() + timeout;
  let nextTextCheck = 0;

  while (Date.now() < deadline) {
    if (
      await proceedToCart.isVisible().catch(() => false) &&
      await proceedToCart.isEnabled().catch(() => false)
    ) {
      return "hold-confirmed";
    }

    if (Date.now() >= nextTextCheck) {
      const visibleText = await page.locator("body").innerText().catch(() => "");
      if (RELEASE_GATE_PATTERN.test(visibleText)) return "release-not-open";
      if (NO_INVENTORY_PATTERN.test(visibleText)) return "not-enough-availability";
      if (INTERRUPTION_PATTERN.test(visibleText)) return "interruption";
      nextTextCheck = Date.now() + 40;
    }
    await page.waitForTimeout(15);
  }
  return "ambiguous";
}

async function dismissReleaseGateMessage(page) {
  const dialogButtons = page.locator(
    '[role="dialog"]:visible button:visible, mat-dialog-container:visible button:visible'
  );
  if (typeof dialogButtons.count === "function") {
    const count = await dialogButtons.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const button = dialogButtons.nth(index);
      const label = (await button.innerText().catch(() => "")).trim();
      if (/^(ok|close|dismiss|understood|continue)$/i.test(label)) {
        await button.click().catch(() => {});
        return;
      }
    }
  }
  if (page.keyboard?.press) {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

/**
 * Release-only fast path. It retries Reserve on the already-selected cell only
 * after Parks Canada explicitly reports that the time gate is still closed.
 * An ambiguous response is never retried because the first click may have
 * created a hold.
 */
export async function advanceReleaseToCheckout(page, options = {}) {
  const reserveTimeout = options.reserveTimeout ?? 3_000;
  const outcomeTimeout = options.outcomeTimeout ?? 1_500;
  const retryWindow = options.retryWindow ?? 10_000;
  const retryInterval = options.retryInterval ?? 150;
  const startedAt = Date.now();
  const deadline = startedAt + retryWindow;
  let attempts = 0;
  let firstReserveClickedMs = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    const reserve = page
      .locator(
        "#reserveButton:visible, #reserveButtonMulti:visible, #reserveButtonGridView:visible"
      )
      .first();
    if (!(await waitForEnabled(page, reserve, reserveTimeout))) {
      return {
        advanced: false,
        held: false,
        stage: "unknown",
        reason: "reserve-button-not-found",
        attempts,
        timing: { totalMs: Date.now() - startedAt }
      };
    }

    try {
      await clickSafeAction(reserve, "Reserve");
    } catch (error) {
      return {
        advanced: false,
        held: false,
        stage: "unknown",
        reason: "checkout-flow-error",
        error: error.message,
        attempts,
        timing: { totalMs: Date.now() - startedAt }
      };
    }

    const reserveClickedMs = Date.now() - startedAt;
    firstReserveClickedMs ??= reserveClickedMs;
    const outcome = await waitForReleaseOutcome(page, outcomeTimeout);

    if (outcome === "hold-confirmed") {
      const checkoutStartedMs = Date.now() - startedAt;
      const result = await advanceToCheckout(page, {
        ...options,
        reserveFirst: false
      });
      const childTiming = result.timing ?? {};
      return {
        ...result,
        attempts,
        timing: {
          ...childTiming,
          firstReserveClickedMs,
          reserveClickedMs,
          holdConfirmedMs: checkoutStartedMs,
          cartOpenedMs: childTiming.cartOpenedMs == null
            ? null
            : checkoutStartedMs + childTiming.cartOpenedMs,
          checkoutOpenedMs: childTiming.checkoutOpenedMs == null
            ? null
            : checkoutStartedMs + childTiming.checkoutOpenedMs,
          totalMs: Date.now() - startedAt
        }
      };
    }

    if (outcome === "interruption") {
      return {
        advanced: false,
        held: false,
        holdMayExist: true,
        stage: "unknown",
        reason: "release-interruption",
        attempts,
        timing: {
          firstReserveClickedMs,
          reserveClickedMs,
          totalMs: Date.now() - startedAt
        }
      };
    }

    if (outcome === "ambiguous") {
      return {
        advanced: false,
        held: false,
        holdMayExist: true,
        stage: "unknown",
        reason: "hold-not-confirmed",
        attempts,
        timing: {
          firstReserveClickedMs,
          reserveClickedMs,
          totalMs: Date.now() - startedAt
        }
      };
    }

    if (outcome === "not-enough-availability") {
      await dismissReleaseGateMessage(page);
      return {
        advanced: false,
        held: false,
        stage: "unknown",
        reason: "not-enough-availability",
        attempts,
        timing: {
          firstReserveClickedMs,
          reserveClickedMs,
          totalMs: Date.now() - startedAt
        }
      };
    }

    console.log(
      `Release gate still closed after Reserve attempt ${attempts}; retrying the selected cell.`
    );
    if (Date.now() + retryInterval > deadline) break;
    await dismissReleaseGateMessage(page);
    await page.waitForTimeout(retryInterval);
  }

  return {
    advanced: false,
    held: false,
    stage: "unknown",
    reason: "release-not-open",
    attempts,
    timing: {
      firstReserveClickedMs,
      totalMs: Date.now() - startedAt
    }
  };
}

export async function advanceToCheckout(page, options = {}) {
  const reserveTimeout = options.reserveTimeout ?? 15_000;
  const holdTimeout = options.holdTimeout ?? 25_000;
  // The Parks Canada cart backend can take more than 30 seconds during a
  // release surge. These are maximum waits only: enabled controls are still
  // clicked immediately, while a slow but successful transition no longer
  // causes an unnecessary manual handoff.
  const navigationTimeout = options.navigationTimeout ?? 60_000;
  const checkoutTimeout = options.checkoutTimeout ?? 60_000;
  const reserveFirst = options.reserveFirst === true;
  const startedAt = Date.now();
  const timing = {};
  let reserveClicked = false;
  let held = false;

  try {
    const existingText = reserveFirst
      ? ""
      : await page.locator("body").innerText().catch(() => "");
    const existingStage = reserveFirst
      ? "unknown"
      : checkoutStageFrom(existingText, page.url());
    if (existingStage === "checkout" || existingStage === "payment") {
      return {
        advanced: true,
        held: true,
        stage: existingStage,
        reason: "already-there",
        timing: { totalMs: Date.now() - startedAt }
      };
    }

    if (existingStage !== "cart") {
      const proceedToCart = page.locator("#proceedToCartButton:visible").first();
      if (reserveFirst || !(await proceedToCart.isVisible().catch(() => false))) {
        const reserve = page
          .locator(
            "#reserveButton:visible, #reserveButtonMulti:visible, #reserveButtonGridView:visible"
          )
          .first();
        if (!(await waitForEnabled(page, reserve, reserveTimeout))) {
          return {
            advanced: false,
            held: false,
            stage: "unknown",
            reason: "reserve-button-not-found",
            timing: { totalMs: Date.now() - startedAt }
          };
        }

        await clickSafeAction(reserve, "Reserve");
        reserveClicked = true;
        timing.reserveClickedMs = Date.now() - startedAt;
      }

      if (!(await waitForEnabled(page, proceedToCart, holdTimeout))) {
        return {
          advanced: false,
          held: false,
          holdMayExist: reserveClicked,
          stage: "unknown",
          reason: "hold-not-confirmed",
          timing: { ...timing, totalMs: Date.now() - startedAt }
        };
      }
      held = true;
      timing.holdConfirmedMs = Date.now() - startedAt;

      const cartNavigation = page
        .waitForURL(/\/cart(?:[/?]|$)/i, { timeout: navigationTimeout })
        .catch(() => null);
      await clickSafeAction(proceedToCart, "Proceed to cart");
      await cartNavigation;
      if (!/\/cart(?:[/?]|$)/i.test(page.url())) {
        return {
          advanced: false,
          held,
          stage: checkoutStageFrom(
            await page.locator("body").innerText().catch(() => ""),
            page.url()
          ),
          reason: "cart-not-open",
          timing: { ...timing, totalMs: Date.now() - startedAt }
        };
      }
      timing.cartOpenedMs = Date.now() - startedAt;
    } else {
      held = true;
      timing.cartOpenedMs = 0;
    }

    const checkout = page.locator("#proceedToCheckout:visible").first();
    if (!(await waitForEnabled(page, checkout, checkoutTimeout))) {
      return {
        advanced: false,
        held,
        stage: "cart",
        reason: await checkout.isVisible().catch(() => false)
          ? "checkout-button-disabled"
          : "checkout-button-not-found",
        timing: { ...timing, totalMs: Date.now() - startedAt }
      };
    }

    const checkoutNavigation = page
      .waitForURL((url) => !/\/cart(?:[/?]|$)/i.test(url.toString()), {
        timeout: checkoutTimeout
      })
      .catch(() => null);
    await clickSafeAction(checkout, "Checkout");
    await checkoutNavigation;
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    timing.checkoutOpenedMs = Date.now() - startedAt;

    const nextText = await page.locator("body").innerText().catch(() => "");
    const stage = checkoutStageFrom(nextText, page.url());
    return {
      advanced: stage === "checkout" || stage === "payment",
      held,
      stage,
      reason: stage === "checkout" || stage === "payment"
        ? "checkout-open"
        : "checkout-not-open",
      timing: { ...timing, totalMs: Date.now() - startedAt }
    };
  } catch (error) {
    return {
      advanced: false,
      held,
      holdMayExist: reserveClicked,
      stage: checkoutStageFrom(
        await page.locator("body").innerText().catch(() => ""),
        page.url()
      ),
      reason: "checkout-flow-error",
      error: error.message,
      timing: { ...timing, totalMs: Date.now() - startedAt }
    };
  }
}

export function checkoutStageMessage(result) {
  if (result.stage === "payment") {
    return "The payment/review stage is open. Automation has stopped before payment.";
  }
  if (result.stage === "checkout") {
    return "Checkout is open. Complete any required details and payment yourself.";
  }
  if (result.stage === "cart") {
    return "The cart is open. Continue manually; automation will not confirm or pay.";
  }
  if (result.reason === "reserve-button-not-found") {
    return "The date is selected, but the current Reserve control did not appear. Take over now.";
  }
  if (result.reason === "hold-not-confirmed") {
    return "Reserve was clicked, but the cart hold could not be confirmed. Take over now.";
  }
  if (result.reason === "checkout-button-disabled") {
    return "The cart hold is confirmed, but Checkout is still disabled. Take over in the cart.";
  }
  if (result.reason === "checkout-button-not-found") {
    return "The cart hold is confirmed, but the Checkout control changed. Take over in the cart.";
  }
  if (result.error) {
    return `The cart flow stopped safely: ${result.error}. Take over now.`;
  }
  return "The cart flow stopped before checkout. Take over now; automation will not confirm or pay.";
}
