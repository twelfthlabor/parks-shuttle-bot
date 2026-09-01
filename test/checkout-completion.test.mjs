import test from "node:test";
import assert from "node:assert/strict";
import {
  completeCheckout,
  parseTotalCad,
  targetDateAppears
} from "../src/checkout-completion.mjs";

class FakeItem {
  constructor(page, kind, index = 0) {
    this.page = page;
    this.kind = kind;
    this.index = index;
  }

  first() {
    return this;
  }

  nth(index) {
    return new FakeItem(this.page, this.kind, index);
  }

  async count() {
    if (this.kind === "buttons") return this.page.buttons().length;
    return 0;
  }

  async innerText() {
    if (this.kind === "body") return this.page.body();
    return this.page.buttons()[this.index] ?? "";
  }

  async isEnabled() {
    return true;
  }

  async isVisible() {
    return this.kind === "buttons";
  }

  async getAttribute() {
    return "";
  }

  async click() {
    this.page.click(this.page.buttons()[this.index]);
  }
}

class FakeCompletionPage {
  constructor(total = 29) {
    this.step = "review";
    this.total = total;
    this.clicks = [];
  }

  locator(selector) {
    if (selector === "body") return new FakeItem(this, "body");
    if (selector.includes("button")) return new FakeItem(this, "buttons");
    return new FakeItem(this, "empty");
  }

  getByRole() {
    return new FakeItem(this, "empty");
  }

  url() {
    if (this.step === "review") {
      return "https://reservation.pc.gc.ca/create-booking/reviewpolicies";
    }
    if (this.step === "payment") {
      return "https://reservation.pc.gc.ca/create-booking/payment";
    }
    return "https://reservation.pc.gc.ca/create-booking/confirmation";
  }

  body() {
    if (this.step === "review") return "Review policies";
    if (this.step === "payment") {
      return `Moraine Lake Tuesday, July 28, 2026 Total $${this.total.toFixed(2)}`;
    }
    return "Reservation confirmed. Booking number ABC12345";
  }

  buttons() {
    if (this.step === "review") return ["Continue"];
    if (this.step === "payment") return ["Confirm and Pay"];
    return [];
  }

  click(label) {
    this.clicks.push(label);
    if (label === "Continue") this.step = "payment";
    if (label === "Confirm and Pay") this.step = "confirmation";
  }

  async waitForURL() {}

  async waitForTimeout() {}
}

test("parses a labelled CAD checkout total", () => {
  assert.equal(parseTotalCad("Subtotal $25.50 Grand total CAD $29.00"), 29);
  assert.equal(parseTotalCad("No price shown"), null);
});

test("recognizes common target-date formats", () => {
  assert.equal(targetDateAppears("Tuesday, July 28, 2026", "2026-07-28"), true);
  assert.equal(targetDateAppears("Wednesday, July 29, 2026", "2026-07-28"), false);
});

test("continues checkout and submits a validated capped purchase", async () => {
  const page = new FakeCompletionPage(29);
  const result = await completeCheckout(page, {
    targetDate: "2026-07-28",
    autoSubmitPurchase: true,
    maxTotalCad: 40
  });

  assert.deepEqual(page.clicks, ["Continue", "Confirm and Pay"]);
  assert.equal(result.purchased, true);
  assert.equal(result.reason, "reservation-confirmed");
  assert.equal(result.totalCad, 29);
});

test("never submits a purchase above the configured cap", async () => {
  const page = new FakeCompletionPage(45);
  const result = await completeCheckout(page, {
    targetDate: "2026-07-28",
    autoSubmitPurchase: true,
    maxTotalCad: 40
  });

  assert.deepEqual(page.clicks, ["Continue"]);
  assert.equal(result.purchased, false);
  assert.equal(result.reason, "purchase-total-not-approved");
  assert.equal(result.totalCad, 45);
});
