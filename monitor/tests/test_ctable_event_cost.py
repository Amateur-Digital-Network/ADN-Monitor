"""Per voice event the monitor rebuilt UA chips, fingerprinted and sent the whole CTABLE."""

from __future__ import annotations

from adn_monitor.application import ws_ctable_views
from adn_monitor.application.tgstats import parse_options_to_static


def test_parsed_options_are_cached_but_each_caller_gets_its_own_copy() -> None:
    first = parse_options_to_static("TS1=214;TS2=730,7301;TIMER=60;SINGLE=1;")
    first["TS2_STATIC"].append("999")
    first["TIMER"] = 0
    again = parse_options_to_static("TS1=214;TS2=730,7301;TIMER=60;SINGLE=1;")
    assert again == {"TS1_STATIC": ["214"], "TS2_STATIC": ["730", "7301"], "TIMER": 60.0, "SINGLE": "1"}


def test_fingerprint_is_stable_and_still_handles_mixed_key_types() -> None:
    a = {"MASTERS": {"SYSTEM-1": {"PEERS": {730039101: {1: {"TGID": 730}, "2": {"TGID": 214}}}}}}
    b = {"MASTERS": {"SYSTEM-1": {"PEERS": {730039101: {"2": {"TGID": 214}, 1: {"TGID": 730}}}}}}
    assert ws_ctable_views._fingerprint_dumps(a) == ws_ctable_views._fingerprint_dumps(b)
    assert ws_ctable_views._fingerprint_dumps(a) != ws_ctable_views._fingerprint_dumps({"MASTERS": {}})


def test_main_dashboard_leaves_out_masters_without_peers_unless_empty_masters() -> None:
    """An inject-only server reports one SYSTEM-N per MAX_PEERS slot (200 in docker)."""
    ctable = {
        "MASTERS": {"SYSTEM-0": {"REPEAT": "isolate", "PEERS": {730039101: {}}},
                    **{f"SYSTEM-{n}": {"REPEAT": "isolate", "PEERS": {}} for n in range(1, 200)}},
        "PEERS": {},
        "OPENBRIDGES": {},
    }
    assert list(ws_ctable_views.ctable_for_main(ctable)["MASTERS"]) == ["SYSTEM-0"]
    assert len(ws_ctable_views.ctable_for_main(ctable, empty_masters=True)["MASTERS"]) == 200
