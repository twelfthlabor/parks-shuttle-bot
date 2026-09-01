import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BINDING_NAME = "__reportMoraineDomStatus";

function compact(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function isAvailableDomState(event) {
  const status = `${event?.aria ?? ""} ${event?.classes ?? ""}`;
  return (
    /\bAvailable\b/i.test(status) &&
    !/\bUnavailable\b/i.test(status) &&
    event?.disabled !== true
  );
}

export class DomStatusJournal {
  constructor({ outputDir, targetDate, now = new Date(), onEvent = null }) {
    mkdirSync(outputDir, { recursive: true });
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(
      outputDir,
      `dom-status-${targetDate}-${timestamp}.jsonl`
    );
    this.onEvent = onEvent;
    this.previous = new Map();
  }

  record(rawEvent) {
    const event = {
      recordedAt: new Date().toISOString(),
      browserEpochMs: Number(rawEvent?.browserEpochMs) || null,
      type: rawEvent?.type === "control" ? "control" : "cell",
      url: String(rawEvent?.url ?? ""),
      targetDate: String(rawEvent?.targetDate ?? ""),
      rowLabel: compact(rawEvent?.rowLabel),
      controlId: String(rawEvent?.controlId ?? ""),
      label: compact(rawEvent?.label),
      aria: compact(rawEvent?.aria),
      classes: compact(rawEvent?.classes),
      disabled: rawEvent?.disabled === true,
      visible: rawEvent?.visible !== false,
      selected: rawEvent?.selected === true
    };
    event.available = event.type === "cell" && isAvailableDomState(event);

    const key = event.type === "cell"
      ? `${event.type}|${event.targetDate}|${event.rowLabel}`
      : `${event.type}|${event.controlId}`;
    const signature = JSON.stringify([
      event.aria,
      event.classes,
      event.disabled,
      event.visible,
      event.selected,
      event.available
    ]);
    if (this.previous.get(key) === signature) return false;
    this.previous.set(key, signature);

    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    if (typeof this.onEvent === "function") this.onEvent(event);
    return true;
  }
}

function installObserverInPage({ targetDate, bindingName }) {
  if (globalThis.__moraineDomObserverInstalled) return;
  globalThis.__moraineDomObserverInstalled = true;

  const previous = new Map();
  let scanQueued = false;

  const report = (event) => {
    const reporter = globalThis[bindingName];
    if (typeof reporter !== "function") return;
    Promise.resolve(reporter({
      ...event,
      browserEpochMs: Date.now(),
      targetDate,
      url: location.href
    })).catch(() => {});
  };

  const changed = (key, signature, event) => {
    if (previous.get(key) === signature) return;
    previous.set(key, signature);
    report(event);
  };

  const isVisible = (element) => {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const scan = () => {
    scanQueued = false;

    for (const cell of document.querySelectorAll("td[data-e2e-date]")) {
      if (cell.getAttribute("data-e2e-date") !== targetDate) continue;
      const rowLabel = (cell.closest("tr")?.children?.[0]?.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!rowLabel.startsWith("Moraine Lake:")) continue;

      const event = {
        type: "cell",
        rowLabel,
        aria: cell.getAttribute("aria-label") || "",
        classes: typeof cell.className === "string" ? cell.className : "",
        disabled:
          cell.hasAttribute("disabled") ||
          cell.getAttribute("aria-disabled") === "true",
        visible: isVisible(cell),
        selected:
          cell.getAttribute("aria-selected") === "true" ||
          /\b(selected|active)\b/i.test(
            typeof cell.className === "string" ? cell.className : ""
          )
      };
      changed(
        `cell|${targetDate}|${rowLabel}`,
        JSON.stringify(event),
        event
      );
    }

    const selectors = [
      "#reserveButton",
      "#reserveButtonMulti",
      "#reserveButtonGridView",
      "#proceedToCartButton",
      "#proceedToCheckout"
    ];
    for (const selector of selectors) {
      const control = document.querySelector(selector);
      if (!control) continue;
      const event = {
        type: "control",
        controlId: control.id,
        label: (control.textContent || "").trim().replace(/\s+/g, " "),
        aria: control.getAttribute("aria-label") || "",
        classes: typeof control.className === "string" ? control.className : "",
        disabled:
          control.hasAttribute("disabled") ||
          control.getAttribute("aria-disabled") === "true",
        visible: isVisible(control),
        selected: false
      };
      changed(`control|${control.id}`, JSON.stringify(event), event);
    }
  };

  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(scan);
  };

  const start = () => {
    if (!document.documentElement) {
      setTimeout(start, 0);
      return;
    }
    const observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: [
        "aria-disabled",
        "aria-label",
        "aria-selected",
        "class",
        "disabled",
        "hidden",
        "style"
      ]
    });
    queueScan();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

export async function installDomStatusMonitor(
  context,
  { outputDir, targetDate, onEvent = null }
) {
  const journal = new DomStatusJournal({ outputDir, targetDate, onEvent });
  await context.exposeBinding(BINDING_NAME, (_source, event) => {
    const recorded = journal.record(event);
    if (!recorded) return;
    if (event.type === "cell") {
      const state = isAvailableDomState(event) ? "AVAILABLE" : "not available";
      console.log(`DOM status: ${compact(event.rowLabel)} → ${state}`);
    } else {
      console.log(
        `DOM control: ${compact(event.label) || event.controlId} → ` +
        `${event.visible === false ? "hidden" : event.disabled ? "disabled" : "ready"}`
      );
    }
  });
  await context.addInitScript(installObserverInPage, {
    targetDate,
    bindingName: BINDING_NAME
  });
  return journal;
}
