"""MAP section of the dashboard config API (map page settings)."""

from __future__ import annotations

from adn_monitor.application.dashboard_config import build_dashboard_config


def test_map_defaults_when_section_missing():
    cfg = build_dashboard_config({"DASHBOARD": {"DASHTITLE": "ADN"}})["map"]
    assert cfg["enabled"] is True
    assert cfg["center"] == [20.0, 0.0]
    # Hotspots are somebody's home: coarsened unless the sysop says otherwise.
    assert cfg["hotspotPrecision"] == 2
    assert cfg["repeaterPrecision"] is None
    assert cfg["overrides"] == {}


def test_map_reads_top_level_section():
    cfg = build_dashboard_config(
        {
            "DASHBOARD": {},
            "MAP": {
                "ENABLED": False,
                "CENTER": [42.5, 1.52],
                "ZOOM": "8",
                "HOTSPOT_PRECISION": None,
                "GPS_URL": "https://example.org/positions.json",
                "GPS_REFRESH_SEC": "30",
                "OVERRIDES": {2130035: [42.5063, 1.5218], "bad": [999, 0], "short": [1]},
            },
        }
    )["map"]
    assert cfg["enabled"] is False
    assert cfg["center"] == [42.5, 1.52]
    assert cfg["zoom"] == 8
    assert cfg["hotspotPrecision"] is None
    assert cfg["gpsUrl"] == "https://example.org/positions.json"
    assert cfg["gpsRefreshSec"] == 30
    assert cfg["overrides"] == {"2130035": [42.5063, 1.5218]}


def test_map_nested_under_dashboard_and_bad_values_fall_back():
    cfg = build_dashboard_config(
        {"DASHBOARD": {"map": {"zoom": "not-a-number", "center": "nope", "approx_by_country": "no"}}}
    )["map"]
    assert cfg["zoom"] == 2
    assert cfg["center"] == [20.0, 0.0]
    assert cfg["approxByCountry"] is False


def test_loader_keeps_top_level_map_section(tmp_path):
    """A top-level ``MAP:`` block must survive load_config() to reach the API."""
    from adn_monitor.infrastructure.config_loader import load_config

    yaml_path = tmp_path / "adn-monitor.yaml"
    yaml_path.write_text(
        "GLOBAL: {}\nDASHBOARD:\n  DASHTITLE: ADN\nMAP:\n  ENABLED: true\n  ZOOM: 6\n",
        encoding="utf-8",
    )
    result = load_config(str(yaml_path))
    config = result.value if hasattr(result, "value") else result
    assert build_dashboard_config(config)["map"]["zoom"] == 6
