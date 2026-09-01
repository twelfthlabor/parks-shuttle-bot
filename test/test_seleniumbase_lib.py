import json
import unittest
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from src.seleniumbase_lib import (
    build_search_url,
    is_available_slot_label,
    is_available_status,
    is_final_purchase_action,
    order_slot_labels,
    release_time_for,
    target_date_header,
)


class SeleniumBaseHelpersTest(unittest.TestCase):
    def test_release_time_uses_mountain_time(self):
        release = release_time_for("2026-09-15")
        self.assertEqual(release.isoformat(), "2026-09-13T08:00:00-06:00")

    def test_target_header_matches_live_grid(self):
        self.assertEqual(target_date_header("2026-09-15"), "Tue, Sep 15")

    def test_builds_verified_search_url(self):
        now = datetime(
            2026, 7, 23, 19, 0, tzinfo=ZoneInfo("America/Edmonton")
        )
        parsed = urlparse(build_search_url("2026-09-15", 2, now))
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.netloc, "reservation.pc.gc.ca")
        self.assertEqual(parsed.path, "/create-booking/results")
        self.assertEqual(query["startDate"], ["2026-09-15"])
        self.assertEqual(query["endDate"], ["2026-09-16"])
        self.assertEqual(
            json.loads(query["peopleCapacityCategoryCounts"][0]),
            [[-32767, None, 2, None]],
        )

    def test_availability_never_matches_unavailable(self):
        self.assertTrue(
            is_available_slot_label(
                "Time Slot 6:30am-7am Departures AvailableAvailable"
            )
        )
        self.assertFalse(
            is_available_slot_label(
                "Time Slot 6:30am-7am Departures UnavailableUnavailable"
            )
        )
        self.assertTrue(is_available_status("Moraine Lake Available chart-cell"))
        self.assertFalse(is_available_status("Moraine Lake Unavailable"))

    def test_orders_preferred_windows(self):
        labels = [
            "Time Slot 12pm-1pm Departures Available",
            "Time Slot 6:30am-7am Departures Available",
            "Time Slot 4pm-5pm Departures Available",
        ]
        ordered = order_slot_labels(labels, ["4pm-5pm", "6:30am-7am"])
        self.assertIn("4pm-5pm", ordered[0])
        self.assertIn("6:30am-7am", ordered[1])

    def test_blocks_final_purchase_actions(self):
        self.assertFalse(is_final_purchase_action("Proceed to checkout"))
        self.assertFalse(is_final_purchase_action("Reserve"))
        self.assertTrue(is_final_purchase_action("Confirm and pay"))
        self.assertTrue(is_final_purchase_action("Complete reservation"))


if __name__ == "__main__":
    unittest.main()
