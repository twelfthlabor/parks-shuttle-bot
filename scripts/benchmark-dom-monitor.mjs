#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { advanceReleaseToCheckout } from "../src/checkout-flow.mjs";
import { installDomStatusMonitor } from "../src/dom-status-monitor.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findChromeExecutable() {
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else if (process.platform === "win32") {
    for (const dir of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env["LocalAppData"]]) {
      if (dir) candidates.push(path.join(dir, "Google", "Chrome", "Application", "chrome.exe"));
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const targetDate = "2026-07-29";

function html(body, script = "") {
  return `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;
}

const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.url === "/cart") {
    response.end(html(
      '<h1>Your cart</h1><button id="proceedToCheckout">Checkout</button>',
      `document.querySelector("#proceedToCheckout").onclick =
        () => location.href = "/create-booking/reviewpolicies";`
    ));
    return;
  }
  if (request.url === "/create-booking/reviewpolicies") {
    response.end(html("<h1>Passenger details</h1>"));
    return;
  }
  response.end(html(
    `<table>
      <tr><th>Activity</th><th>Wed, Jul 29</th></tr>
      <tr>
        <td>Moraine Lake: 6:30am-7am (Last Minute)</td>
        <td id="target-cell" data-e2e-date="${targetDate}"
            aria-label="Moraine Lake: 6:30am-7am (Last Minute) Unavailable"
            class="chart-cell chart-cell--unavailable"></td>
      </tr>
    </table>
    <button id="reserveButton" hidden>Reserve</button>
    <button id="proceedToCartButton" hidden>Proceed</button>
    <div id="release-gate" hidden>Reserving these dates is not yet allowed</div>`,
    `document.querySelector("#target-cell").onclick = () => {
      document.querySelector("#reserveButton").hidden = false;
    };
    let reserveAttempts = 0;
    document.querySelector("#reserveButton").onclick = () => {
      reserveAttempts += 1;
      if (reserveAttempts === 1) {
        document.querySelector("#release-gate").hidden = false;
      } else {
        document.querySelector("#release-gate").hidden = true;
        document.querySelector("#proceedToCartButton").hidden = false;
      }
    };
    document.querySelector("#proceedToCartButton").onclick =
      () => location.href = "/cart";`
  ));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

let browser;
try {
  const chromePath = findChromeExecutable();
  browser = await chromium.launch(
    chromePath ? { headless: true, executablePath: chromePath } : { headless: true }
  );
  const context = await browser.newContext();
  let resolveAvailable;
  const availability = new Promise((resolve) => {
    resolveAvailable = resolve;
  });
  await installDomStatusMonitor(context, {
    outputDir: path.join(projectRoot, "output", "playwright"),
    targetDate,
    onEvent(event) {
      if (event.type === "cell" && event.available) {
        resolveAvailable({ event, receivedAt: Date.now() });
      }
    }
  });

  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.locator("#target-cell").waitFor({ state: "visible" });

  const mutationAt = Date.now();
  await page.locator("#target-cell").evaluate((cell) => {
    cell.setAttribute(
      "aria-label",
      "Moraine Lake: 6:30am-7am (Last Minute) Available"
    );
    cell.classList.remove("chart-cell--unavailable");
  });

  const detected = await Promise.race([
    availability,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DOM availability event was not detected.")), 2_000)
    )
  ]);
  await page.locator("#target-cell").click();
  const result = await advanceReleaseToCheckout(page, {
    reserveTimeout: 2_000,
    outcomeTimeout: 500,
    retryWindow: 2_000,
    retryInterval: 25,
    holdTimeout: 2_000,
    navigationTimeout: 2_000,
    checkoutTimeout: 2_000
  });
  const checkoutAt = Date.now();

  assert.equal(result.held, true);
  assert.equal(result.advanced, true);
  assert.equal(result.stage, "checkout");
  assert.equal(result.attempts, 2);

  console.log(
    `DOM detection: ${Math.max(0, detected.receivedAt - mutationAt)} ms; ` +
    `availability-to-checkout: ${checkoutAt - mutationAt} ms; ` +
    `explicit-gate attempts: ${result.attempts}.`
  );
  console.log("Real-Chromium release retry and safe checkout benchmark passed.");
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
