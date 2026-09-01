#!/usr/bin/env python3
"""Visible, human-in-the-loop SeleniumBase runner for Parks Canada shuttles."""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from importlib.metadata import version
from pathlib import Path

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    NoSuchWindowException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from seleniumbase import Driver

from seleniumbase_lib import (
    HOME_URL,
    build_search_url,
    is_available_slot_label,
    is_available_status,
    is_final_purchase_action,
    order_slot_labels,
    release_time_for,
    validate_date,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROFILE_DIR = PROJECT_ROOT / ".seleniumbase-profile"
CHROME_BINARY = Path(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)
RESERVE_SELECTOR = "#reserveButton, #reserveButtonMulti, #reserveButtonGridView"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="SeleniumBase Moraine Lake shuttle reservation assistant."
    )
    parser.add_argument("--date", help="Trip date in YYYY-MM-DD format.")
    parser.add_argument("--setup", action="store_true", help="Set up sign-in profile.")
    parser.add_argument("--watch", action="store_true", help="Watch for cancellations.")
    parser.add_argument("--dry-run", action="store_true", help="Never select or hold seats.")
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="Preselect the exact cell but never click Reserve.",
    )
    parser.add_argument(
        "--checkout-test",
        action="store_true",
        help="Hold live seats and advance to checkout, never payment.",
    )
    parser.add_argument("--now", action="store_true", help="Skip the release-time wait.")
    parser.add_argument("--no-hold", action="store_true", help="Never click Reserve.")
    result = parser.parse_args()
    if result.preflight:
        result.now = True
        result.no_hold = True
    if result.checkout_test:
        result.now = True
    return result


def load_config() -> dict:
    user_path = PROJECT_ROOT / "config.json"
    example_path = PROJECT_ROOT / "config.example.json"
    return json.loads((user_path if user_path.exists() else example_path).read_text())


def notify(title: str, message: str, speak: bool = False) -> None:
    print(f"\n{title}: {message}\n", flush=True)
    if sys.platform != "darwin":
        return
    clean_title = title.replace('"', "").replace("\\", "")
    clean_message = message.replace('"', "").replace("\\", "")
    subprocess.run(
        [
            "osascript",
            "-e",
            f'display notification "{clean_message}" '
            f'with title "{clean_title}" sound name "Glass"',
        ],
        check=False,
        capture_output=True,
    )
    if speak:
        subprocess.run(
            ["say", f"{clean_title}. {clean_message}"],
            check=False,
            capture_output=True,
        )


def launch_browser():
    options = {
        "browser": "chrome",
        "headless": False,
        "user_data_dir": str(PROFILE_DIR),
        "page_load_strategy": "eager",
        "window_size": "1280,850",
        "chromium_arg": "disable-background-timer-throttling",
    }
    if CHROME_BINARY.exists():
        options["binary_location"] = str(CHROME_BINARY)
    # Intentionally standard WebDriver mode: no uc=True and no CDP activation.
    return Driver(**options)


def wait_until(predicate, timeout: float, interval: float = 0.1):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (StaleElementReferenceException, WebDriverException) as error:
            last_error = error
        time.sleep(interval)
    if last_error:
        raise TimeoutException(str(last_error))
    raise TimeoutException("Timed out waiting for the requested page state.")


def displayed_elements(driver, by: str, selector: str):
    return [
        element
        for element in driver.find_elements(by, selector)
        if element.is_displayed()
    ]


def first_displayed(driver, selector: str):
    elements = displayed_elements(driver, By.CSS_SELECTOR, selector)
    return elements[0] if elements else None


def click_page_control(driver, element) -> None:
    """Click a non-transactional page control, with an intercepted-click fallback."""
    driver.execute_script(
        "arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});",
        element,
    )
    try:
        element.click()
    except ElementClickInterceptedException:
        driver.execute_script("arguments[0].click();", element)


def accept_cookies(driver) -> None:
    for button in displayed_elements(driver, By.CSS_SELECTOR, "button"):
        if button.text.strip() == "I Consent":
            click_page_control(driver, button)
            return


def is_signed_out(driver) -> bool:
    login = first_displayed(driver, "#login")
    return bool(login and "sign in" in login.text.lower())


def page_text(driver) -> str:
    body = first_displayed(driver, "body")
    return body.text if body else ""


def detect_interruption(driver) -> str | None:
    visible = f"{driver.title} {page_text(driver)}".lower()
    if (
        "reserving these dates is not yet allowed" in visible
        or "cannot be reserved until" in visible
    ):
        return "release-not-open"
    if any(
        text in visible
        for text in (
            "captcha",
            "verify you are human",
            "unusual traffic",
            "azure waf",
            "security check",
        )
    ):
        return (
            "Parks Canada requires human verification. Complete it in the "
            "open browser; the assistant will not solve or bypass it."
        )
    if any(
        text in visible
        for text in ("you are now in line", "queue-it", "estimated wait")
    ):
        return "Parks Canada placed this browser in its queue. Follow the queue in Chrome."
    if any(text in visible for text in ("access denied", "temporarily blocked")):
        return "Parks Canada blocked this attempt. Stop retrying and use the site manually."
    return None


def open_list_view(driver) -> None:
    def find_list_button():
        for candidate in displayed_elements(driver, By.CSS_SELECTOR, "button"):
            label = (
                f"{candidate.get_attribute('aria-label') or ''} {candidate.text}"
            ).lower()
            if "list view" in label or label.strip() == "list":
                return candidate
        return None

    try:
        button = wait_until(find_list_button, 30, 0.2)
    except TimeoutException as error:
        interruption = detect_interruption(driver)
        if interruption:
            raise RuntimeError(interruption) from error
        raise RuntimeError(
            "The results page did not expose a List-view button within 30 seconds."
        ) from error
    click_page_control(driver, button)
    wait_until(
        lambda: displayed_elements(
            driver, By.CSS_SELECTOR, "button[id^='mapLink-button-']"
        ),
        20,
    )


def available_slot_buttons(driver, config: dict):
    buttons = displayed_elements(
        driver, By.CSS_SELECTOR, "button[id^='mapLink-button-']"
    )
    by_label = {
        button.text.strip().replace("\n", " "): button
        for button in buttons
        if is_available_slot_label(button.text)
    }
    ordered = order_slot_labels(
        list(by_label), config.get("preferredDepartureWindows", [])
    )
    return [(label, by_label[label]) for label in ordered]


def moraine_table(driver):
    def find():
        for table in displayed_elements(driver, By.CSS_SELECTOR, "table"):
            if "Moraine Lake:" in table.text:
                return table
        return None

    return wait_until(find, 20)


def exact_available_cell(table, target_date: str):
    candidates = []
    for row in table.find_elements(By.CSS_SELECTOR, "tr")[1:]:
        cells = row.find_elements(By.CSS_SELECTOR, "th, td")
        if not cells:
            continue
        label = cells[0].text.strip()
        if not label.startswith("Moraine Lake:"):
            continue
        for cell in cells[1:]:
            if cell.get_attribute("data-e2e-date") != target_date:
                continue
            status = " ".join(
                filter(
                    None,
                    [
                        cell.get_attribute("aria-label"),
                        cell.get_attribute("class"),
                    ],
                )
            )
            if is_available_status(status):
                candidates.append(
                    (0 if "(Last Minute)" in label else 1, label, cell)
                )
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]))
    _, label, cell = candidates[0]
    return {
        "slot_name": label.removeprefix("Moraine Lake:").strip(),
        "cell": cell,
    }


def choose_preferred_exact_cell(driver, target_date: str, config: dict):
    open_list_view(driver)
    choices = available_slot_buttons(driver, config)
    index = 0
    while index < len(choices):
        label, button = choices[index]
        click_page_control(driver, button)
        table = moraine_table(driver)
        match = exact_available_cell(table, target_date)
        if match:
            match["window_label"] = label
            return match
        index += 1
        if index >= len(choices):
            break
        back = first_displayed(
            driver,
            "#map-back-button, #map-back-button_mobile, "
            "button[aria-label='View previous map']",
        )
        if not back:
            break
        click_page_control(driver, back)
        open_list_view(driver)
        choices = available_slot_buttons(driver, config)
    return None


def safe_click(element, description: str) -> None:
    label = (element.text or description).strip().replace("\n", " ")
    if is_final_purchase_action(label):
        raise RuntimeError(
            f'Safety stop: refused to click final purchase action "{label}".'
        )
    element.click()
    print(f"Checkout flow: clicked {description} ({label})", flush=True)


def wait_for_enabled(driver, selector: str, timeout: float):
    return wait_until(
        lambda: (
            element
            if (element := first_displayed(driver, selector))
            and element.is_enabled()
            else None
        ),
        timeout,
        0.05,
    )


def advance_to_checkout(driver, reserve_first: bool = True) -> dict:
    started = time.monotonic()
    held = False
    try:
        if reserve_first:
            reserve = wait_for_enabled(driver, RESERVE_SELECTOR, 15)
            safe_click(reserve, "Reserve")
        proceed = wait_for_enabled(driver, "#proceedToCartButton", 25)
        held = True
        safe_click(proceed, "Proceed to cart")
        wait_until(lambda: "/cart" in driver.current_url.lower(), 25)
        checkout = wait_for_enabled(driver, "#proceedToCheckout", 30)
        safe_click(checkout, "Checkout")
        wait_until(lambda: "/cart" not in driver.current_url.lower(), 30)
        return {
            "advanced": True,
            "held": True,
            "url": driver.current_url,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }
    except (RuntimeError, TimeoutException, WebDriverException) as error:
        return {
            "advanced": False,
            "held": held,
            "url": driver.current_url,
            "error": str(error),
            "elapsed_ms": round((time.monotonic() - started) * 1000),
        }


def server_clock_offset(sample_count: int) -> tuple[float, float | None]:
    samples = []
    url = f"{HOME_URL}api/transactionlocation/servertime"
    for _ in range(max(1, sample_count)):
        started = time.time()
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                raw = json.loads(response.read().decode("utf-8"))
            ended = time.time()
            server = datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
            samples.append((ended - started, server - ((started + ended) / 2)))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    if not samples:
        return 0.0, None
    round_trip, offset = min(samples, key=lambda sample: sample[0])
    return offset, round_trip


def wait_until_epoch(target: float, label: str) -> None:
    last_minute = None
    while time.time() < target:
        remaining = target - time.time()
        minute = int((remaining + 59) // 60)
        if minute != last_minute and (minute <= 10 or minute % 15 == 0):
            print(
                f"{label}: {minute} minute{'s' if minute != 1 else ''} remaining",
                flush=True,
            )
            last_minute = minute
        time.sleep(min(1, max(0.01, remaining)))


def keep_open_for_handoff(driver, message: str) -> None:
    notify("Your action is needed", message, speak=True)
    if sys.stdin.isatty():
        input(
            "The SeleniumBase Chrome window will stay open. "
            "Press Enter when finished..."
        )
        return
    deadline = time.monotonic() + 30 * 60
    while time.monotonic() < deadline:
        try:
            if not driver.window_handles:
                return
        except (NoSuchWindowException, WebDriverException):
            return
        time.sleep(1)


def setup_profile() -> int:
    driver = launch_browser()
    try:
        driver.open(HOME_URL)
        accept_cookies(driver)
        keep_open_for_handoff(
            driver,
            "Sign in to Parks Canada in this dedicated SeleniumBase Chrome "
            "profile, then return to the reservation page.",
        )
        if is_signed_out(driver):
            notify(
                "Setup not confirmed",
                "The SeleniumBase profile still appears signed out. Run setup again.",
            )
            return 1
        notify("Setup complete", "The SeleniumBase signed-in profile is ready.")
        return 0
    finally:
        driver.quit()


def scan_once(
    driver,
    target_date: str,
    config: dict,
    *,
    allow_hold: bool,
    diagnostic: bool = False,
) -> dict:
    driver.open(build_search_url(target_date, int(config["partySize"])))
    accept_cookies(driver)
    interruption = detect_interruption(driver)
    if interruption:
        return {"status": "interrupted", "message": interruption}
    try:
        match = choose_preferred_exact_cell(driver, target_date, config)
    except (RuntimeError, TimeoutException, WebDriverException) as error:
        return {"status": "interrupted", "message": str(error)}
    if diagnostic:
        print(
            "Exact-date result:",
            match["slot_name"] if match else "not available",
            flush=True,
        )
    if not match:
        return {"status": "unavailable"}
    if not allow_hold:
        return {"status": "found", "held": False, **match}
    click_page_control(driver, match["cell"])
    checkout = advance_to_checkout(driver)
    return {
        "status": "found",
        "held": checkout["held"],
        "checkout": checkout,
        **match,
    }


def run_watch(driver, target_date: str, config: dict, flags) -> dict:
    poll_seconds = max(60, int(config.get("pollSeconds", 120)))
    jitter = max(0, int(config.get("pollJitterSeconds", 15)))
    deadline = (
        time.monotonic()
        + max(1, int(config.get("maxWatchMinutes", 180))) * 60
    )
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        print(
            f"Cancellation check {attempt} at {datetime.now():%H:%M:%S}",
            flush=True,
        )
        result = scan_once(
            driver,
            target_date,
            config,
            allow_hold=should_hold(config, flags),
            diagnostic=flags.dry_run,
        )
        if result["status"] != "unavailable":
            return result
        time.sleep(poll_seconds + random.uniform(0, jitter))
    return {"status": "expired"}


def should_hold(config: dict, flags) -> bool:
    if flags.no_hold or flags.dry_run:
        return False
    return flags.checkout_test or config.get("autoHold") is not False


def run_release(driver, target_date: str, config: dict, flags) -> dict:
    release = release_time_for(target_date)
    release_epoch = release.timestamp()
    preload = max(5, int(config.get("preloadLeadSeconds", 120)))
    if not flags.now:
        wait_until_epoch(release_epoch - preload, "Preload")

    driver.open(build_search_url(target_date, int(config["partySize"])))
    accept_cookies(driver)
    interruption = detect_interruption(driver)
    if interruption and interruption != "release-not-open":
        return {"status": "interrupted", "message": interruption}
    try:
        match = choose_preferred_exact_cell(driver, target_date, config)
    except (RuntimeError, TimeoutException, WebDriverException) as error:
        return {"status": "interrupted", "message": str(error)}
    if match:
        match["selected"] = False
        if not flags.dry_run:
            click_page_control(driver, match["cell"])
            match["selected"] = True
            wait_for_enabled(driver, RESERVE_SELECTOR, 10)

    if flags.preflight:
        return (
            {"status": "preflight", **match}
            if match
            else {"status": "unavailable", "reason": "pre-arm-failed"}
        )
    if flags.now:
        if not match:
            return scan_once(
                driver,
                target_date,
                config,
                allow_hold=should_hold(config, flags),
                diagnostic=flags.dry_run,
            )
    else:
        calibration_lead = max(
            2, int(config.get("clockCalibrationLeadSeconds", 10))
        )
        wait_until_epoch(release_epoch - calibration_lead, "Clock calibration")
        offset, round_trip = server_clock_offset(
            min(7, max(3, int(config.get("clockCalibrationSamples", 5))))
        )
        if round_trip is not None:
            print(
                f"Parks Canada clock calibration: {offset * 1000:.1f} ms "
                f"offset ({round_trip * 1000:.1f} ms round trip).",
                flush=True,
            )
        else:
            print(
                "Parks Canada clock calibration unavailable; using the Mac clock.",
                flush=True,
            )
        release_offset = (
            max(0, int(config.get("releaseOffsetMilliseconds", 50))) / 1000
        )
        local_click_epoch = release_epoch - offset + release_offset
        if local_click_epoch - time.time() <= 5:
            notify(
                "Moraine Lake release",
                "The exact date is preselected. Be ready in Chrome.",
                speak=True,
            )
        wait_until_epoch(local_click_epoch, "Official release")

    if not match:
        retry_window = max(
            1, int(config.get("releaseRetryWindowSeconds", 10))
        )
        retry_interval = max(
            0.1,
            int(config.get("releaseRetryIntervalMilliseconds", 150)) / 1000,
        )
        deadline = time.monotonic() + retry_window
        while time.monotonic() < deadline:
            result = scan_once(
                driver,
                target_date,
                config,
                allow_hold=should_hold(config, flags),
                diagnostic=flags.dry_run,
            )
            if result["status"] != "unavailable":
                return result
            time.sleep(retry_interval)
        return {"status": "unavailable", "reason": "release-retry-expired"}

    if not should_hold(config, flags):
        return {"status": "found", "held": False, **(match or {})}
    checkout = advance_to_checkout(driver)
    return {
        "status": "found",
        "held": checkout["held"],
        "checkout": checkout,
        **(match or {}),
    }


def main() -> int:
    flags = parse_arguments()
    if flags.setup:
        return setup_profile()
    if not flags.date:
        raise SystemExit("--date is required unless --setup is used.")
    validate_date(flags.date)
    config = load_config()
    print(f"Backend: SeleniumBase {version('seleniumbase')}", flush=True)
    print(f"Target: {flags.date} for {config['partySize']} people", flush=True)
    print(
        "Official 60% release: "
        f"{release_time_for(flags.date):%A, %B %-d at %-I:%M:%S %p %Z}",
        flush=True,
    )

    driver = launch_browser()
    try:
        driver.open(HOME_URL)
        accept_cookies(driver)
        if is_signed_out(driver) and not flags.dry_run:
            keep_open_for_handoff(
                driver,
                "Sign in to Parks Canada in the SeleniumBase Chrome window. "
                "Then press Enter in Terminal so the run can continue.",
            )
            if is_signed_out(driver):
                return 1

        result = (
            run_watch(driver, flags.date, config, flags)
            if flags.watch
            else run_release(driver, flags.date, config, flags)
        )
        if result["status"] == "preflight":
            keep_open_for_handoff(
                driver,
                f"{flags.date}, {result.get('slot_name', 'Moraine Lake')}. "
                "The exact cell and Reserve control are ready; Reserve was not clicked.",
            )
            return 0
        if result["status"] == "found":
            checkout = result.get("checkout")
            if checkout and checkout.get("advanced"):
                message = (
                    f"{flags.date}, {result.get('slot_name', 'Moraine Lake')}. "
                    "Checkout is open. Complete passenger details, verification, "
                    "payment, and final confirmation yourself."
                )
            elif result.get("held"):
                message = (
                    f"{flags.date}, {result.get('slot_name', 'Moraine Lake')}. "
                    "Seats appear held; take over in the open cart."
                )
            else:
                selection = (
                    "the exact date is selected"
                    if result.get("selected", True)
                    else "the exact date was detected but not selected"
                )
                message = (
                    f"{flags.date}, {result.get('slot_name', 'Moraine Lake')}. "
                    f"Availability is open and {selection}. "
                    "Complete the flow yourself."
                )
            keep_open_for_handoff(driver, message)
            return 0
        if result["status"] == "interrupted":
            keep_open_for_handoff(driver, result["message"])
            return 1
        notify(
            "No exact-date availability",
            f"No reservable Moraine Lake cell was found for {flags.date}.",
        )
        return 2
    finally:
        driver.quit()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nStopped by user.", flush=True)
        raise SystemExit(130)
