import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceReleaseToCheckout,
  advanceToCheckout
} from "../src/checkout-flow.mjs";

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() {
    return this;
  }

  async waitFor() {
    if (!this.page.isVisible(this.selector)) {
      throw new Error("not visible");
    }
  }

  async isVisible() {
    return this.page.isVisible(this.selector);
  }

  async isEnabled() {
    return this.page.isEnabled(this.selector);
  }

  async innerText() {
    return this.page.textFor(this.selector);
  }

  async click() {
    this.page.click(this.selector);
  }
}

class FakeCheckoutPage {
  constructor(options = {}) {
    this.currentUrl =
      options.url ?? "https://reservation.pc.gc.ca/create-booking/results?test=1";
    this.reserveVisible = options.reserveVisible ?? true;
    this.proceedVisible = options.proceedVisible ?? false;
    this.checkoutVisible = options.checkoutVisible ?? false;
    this.checkoutEnabled = options.checkoutEnabled ?? true;
    this.confirmHold = options.confirmHold ?? true;
    this.releaseGateAttempts = options.releaseGateAttempts ?? 0;
    this.releaseGateVisible = false;
    this.noInventoryAttempts = options.noInventoryAttempts ?? 0;
    this.noInventoryVisible = false;
    this.reserveAttempts = 0;
    this.openCheckout = options.openCheckout ?? true;
    this.clicks = [];
    this.bodyReads = 0;
    this.waiters = [];
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  url() {
    return this.currentUrl;
  }

  async waitForTimeout() {}

  async waitForLoadState() {}

  waitForURL(matcher, options = {}) {
    if (this.matches(matcher)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error("navigation timeout")),
        options.timeout ?? 20
      );
      this.waiters.push({
        matcher,
        resolve: () => {
          clearTimeout(timeoutId);
          resolve();
        }
      });
    });
  }

  matches(matcher) {
    const url = new URL(this.currentUrl);
    return typeof matcher === "function"
      ? matcher(url)
      : matcher.test(this.currentUrl);
  }

  navigate(url) {
    this.currentUrl = url;
    const pending = this.waiters;
    this.waiters = [];
    for (const waiter of pending) {
      if (this.matches(waiter.matcher)) waiter.resolve();
      else this.waiters.push(waiter);
    }
  }

  keyFor(selector) {
    if (selector === "body") return "body";
    if (selector.includes("#reserveButton")) return "reserve";
    if (selector.includes("#proceedToCartButton")) return "proceed";
    if (selector.includes("#proceedToCheckout")) return "checkout";
    return "unknown";
  }

  isVisible(selector) {
    const key = this.keyFor(selector);
    if (key === "body") return true;
    if (key === "reserve") return this.reserveVisible;
    if (key === "proceed") return this.proceedVisible;
    if (key === "checkout") return this.checkoutVisible;
    return false;
  }

  isEnabled(selector) {
    const key = this.keyFor(selector);
    if (key === "checkout") return this.checkoutEnabled;
    return this.isVisible(selector);
  }

  textFor(selector) {
    const key = this.keyFor(selector);
    if (key === "body") {
      this.bodyReads += 1;
      if (this.releaseGateVisible) {
        return "Reserving these dates is not yet allowed";
      }
      if (this.noInventoryVisible) return "Not enough availability";
      return "";
    }
    if (key === "reserve") return "Reserve";
    if (key === "proceed") return "Proceed";
    if (key === "checkout") return "Checkout";
    return "";
  }

  click(selector) {
    const key = this.keyFor(selector);
    this.clicks.push(key);
    if (key === "reserve") {
      this.reserveAttempts += 1;
      if (this.reserveAttempts <= this.releaseGateAttempts) {
        this.releaseGateVisible = true;
        this.noInventoryVisible = false;
        this.reserveVisible = true;
      } else if (
        this.reserveAttempts <=
        this.releaseGateAttempts + this.noInventoryAttempts
      ) {
        this.releaseGateVisible = false;
        this.noInventoryVisible = true;
        this.reserveVisible = true;
      } else {
        this.releaseGateVisible = false;
        this.noInventoryVisible = false;
        this.reserveVisible = false;
        if (this.confirmHold) this.proceedVisible = true;
      }
    } else if (key === "proceed") {
      this.proceedVisible = false;
      this.checkoutVisible = true;
      this.navigate("https://reservation.pc.gc.ca/cart");
    } else if (key === "checkout" && this.openCheckout) {
      this.navigate("https://reservation.pc.gc.ca/create-booking/reviewpolicies");
    }
  }
}

const fastTimeouts = {
  reserveTimeout: 5,
  holdTimeout: 5,
  navigationTimeout: 20,
  checkoutTimeout: 5
};

test("advances through Reserve, Proceed, and Checkout in order", async () => {
  const page = new FakeCheckoutPage();
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, ["reserve", "proceed", "checkout"]);
  assert.equal(result.held, true);
  assert.equal(result.advanced, true);
  assert.equal(result.stage, "checkout");
  assert.equal(result.reason, "checkout-open");
  assert.equal(typeof result.timing.totalMs, "number");
  assert.equal(typeof result.timing.holdConfirmedMs, "number");
  assert.equal(typeof result.timing.cartOpenedMs, "number");
  assert.equal(typeof result.timing.checkoutOpenedMs, "number");
});

test("pre-armed fast path skips the initial page-wide stage read", async () => {
  const page = new FakeCheckoutPage();
  const result = await advanceToCheckout(page, { ...fastTimeouts, reserveFirst: true });

  assert.deepEqual(page.clicks, ["reserve", "proceed", "checkout"]);
  assert.equal(result.advanced, true);
  assert.equal(page.bodyReads, 1);
});

test("does not report a hold when Reserve never appears", async () => {
  const page = new FakeCheckoutPage({ reserveVisible: false });
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, []);
  assert.equal(result.held, false);
  assert.equal(result.reason, "reserve-button-not-found");
});

test("does not reload after Reserve when the hold cannot be confirmed", async () => {
  const page = new FakeCheckoutPage({ confirmHold: false });
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, ["reserve"]);
  assert.equal(result.held, false);
  assert.equal(result.holdMayExist, true);
  assert.equal(result.reason, "hold-not-confirmed");
});

test("hands off in the cart when Checkout remains disabled", async () => {
  const page = new FakeCheckoutPage({ checkoutEnabled: false });
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, ["reserve", "proceed"]);
  assert.equal(result.held, true);
  assert.equal(result.stage, "cart");
  assert.equal(result.reason, "checkout-button-disabled");
});

test("resumes from an existing cart hold and opens checkout", async () => {
  const page = new FakeCheckoutPage({
    url: "https://reservation.pc.gc.ca/cart",
    reserveVisible: false,
    checkoutVisible: true
  });
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, ["checkout"]);
  assert.equal(result.held, true);
  assert.equal(result.advanced, true);
  assert.equal(result.stage, "checkout");
});

test("keeps the confirmed hold when checkout navigation stalls", async () => {
  const page = new FakeCheckoutPage({ openCheckout: false });
  const result = await advanceToCheckout(page, fastTimeouts);

  assert.deepEqual(page.clicks, ["reserve", "proceed", "checkout"]);
  assert.equal(result.held, true);
  assert.equal(result.advanced, false);
  assert.equal(result.stage, "cart");
  assert.equal(result.reason, "checkout-not-open");
});

test("release fast path retries only an explicit closed-gate response", async () => {
  const page = new FakeCheckoutPage({ releaseGateAttempts: 2 });
  const result = await advanceReleaseToCheckout(page, {
    ...fastTimeouts,
    outcomeTimeout: 5,
    retryWindow: 50,
    retryInterval: 1
  });

  assert.deepEqual(
    page.clicks,
    ["reserve", "reserve", "reserve", "proceed", "checkout"]
  );
  assert.equal(result.attempts, 3);
  assert.equal(result.held, true);
  assert.equal(result.advanced, true);
  assert.equal(result.stage, "checkout");
});

test("release fast path never retries an ambiguous Reserve response", async () => {
  const page = new FakeCheckoutPage({ confirmHold: false });
  const result = await advanceReleaseToCheckout(page, {
    ...fastTimeouts,
    outcomeTimeout: 5,
    retryWindow: 50,
    retryInterval: 1
  });

  assert.deepEqual(page.clicks, ["reserve"]);
  assert.equal(result.attempts, 1);
  assert.equal(result.holdMayExist, true);
  assert.equal(result.reason, "hold-not-confirmed");
});

test("release fast path reports definite inventory loss without a duplicate click", async () => {
  const page = new FakeCheckoutPage({ noInventoryAttempts: 1 });
  const result = await advanceReleaseToCheckout(page, {
    ...fastTimeouts,
    outcomeTimeout: 5,
    retryWindow: 50,
    retryInterval: 1
  });

  assert.deepEqual(page.clicks, ["reserve"]);
  assert.equal(result.attempts, 1);
  assert.equal(result.held, false);
  assert.equal(result.holdMayExist, undefined);
  assert.equal(result.reason, "not-enough-availability");
});
