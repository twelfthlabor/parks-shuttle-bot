"""Pure helpers shared by the SeleniumBase Moraine Lake shuttle runner."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

PARK_TIME_ZONE = ZoneInfo("America/Edmonton")
HOME_URL = "https://reservation.pc.gc.ca/"
SEASON_START = date(2026, 6, 1)
SEASON_END = date(2026, 10, 12)

SEARCH_IDS = {
    "transactionLocationId": "-2147483647",
    "resourceLocationId": "-2147483642",
    "mapId": "-2147483634",
    "searchTabGroupId": "3",
    "bookingCategoryId": "9",
}


def validate_date(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f'Invalid date "{value}". Use YYYY-MM-DD.') from error
    if not SEASON_START <= parsed <= SEASON_END:
        raise ValueError(
            "The 2026 Moraine Lake shuttle season is June 1 through October 12."
        )
    return parsed


def release_time_for(value: str) -> datetime:
    release_day = validate_date(value) - timedelta(days=2)
    return datetime.combine(release_day, time(8, 0), tzinfo=PARK_TIME_ZONE)


def target_date_header(value: str) -> str:
    parsed = validate_date(value)
    return f"{parsed:%a, %b} {parsed.day}"


def build_search_url(
    value: str,
    party_size: int,
    now: datetime | None = None,
) -> str:
    parsed = validate_date(value)
    if not isinstance(party_size, int) or not 1 <= party_size <= 10:
        raise ValueError("partySize must be an integer from 1 to 10.")
    current = now or datetime.now(PARK_TIME_ZONE)
    params = {
        **SEARCH_IDS,
        "startDate": value,
        "endDate": (parsed + timedelta(days=1)).isoformat(),
        "nights": "1",
        "isReserving": "true",
        "peopleCapacityCategoryCounts": json.dumps(
            [[-32767, None, party_size, None]], separators=(",", ":")
        ),
        "searchTime": current.strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{current.microsecond // 1000:03d}",
        "flexibleSearch": json.dumps(
            [False, False, None, 1], separators=(",", ":")
        ),
    }
    return f"{HOME_URL}create-booking/results?{urlencode(params)}"


def normalize_window(value: str) -> str:
    return re.sub(r"\s+", "", value.lower()).replace("–", "-").replace("—", "-")


def is_available_slot_label(value: str | None) -> bool:
    label = str(value or "")
    return bool(re.search(r"available", label, re.I)) and not bool(
        re.search(r"unavailable", label, re.I)
    )


def slot_label_key(value: str) -> str:
    return re.sub(
        r"partialavailability|unavailable|available",
        "",
        normalize_window(value),
    )


def order_slot_labels(labels: list[str], preferred: list[str]) -> list[str]:
    preference = [normalize_window(item) for item in preferred]

    def rank(label: str) -> tuple[int, str]:
        normalized = normalize_window(label)
        try:
            index = next(
                index
                for index, wanted in enumerate(preference)
                if wanted in normalized
            )
        except StopIteration:
            index = len(preference) + 1
        return index, label

    return sorted(labels, key=rank)


def is_available_status(value: str | None) -> bool:
    status = str(value or "")
    return bool(re.search(r"\bavailable\b", status, re.I)) and not bool(
        re.search(r"\bunavailable\b", status, re.I)
    )


def is_final_purchase_action(label: str | None) -> bool:
    normalized = re.sub(r"\s+", " ", str(label or "")).strip()
    return bool(
        re.search(
            r"\b(pay now|submit payment|complete purchase|confirm and pay|"
            r"place order|complete reservation|confirm reservation|book now)\b",
            normalized,
            re.I,
        )
    )
