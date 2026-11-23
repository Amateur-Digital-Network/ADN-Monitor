"""Unit tests for OPTIONS parsing (standard + OpenSpot formats)."""

from __future__ import annotations

from adn_monitor.application.self_service_options import (
    normalize_options_for_save,
    parse_options,
)


def test_parse_standard_format():
    result = parse_options("TS1=262,110;TS2=2628;")
    assert result["TS1"] == ["262", "110"]
    assert result["TS2"] == ["2628"]


def test_parse_openspot_format():
    result = parse_options(
        "StartRef=4010;RelinkTime=30;UserLink=1;CQWW=1;"
        "TS1_1=262;TS1_2=110;TS1_3=1;TS1_4=20;TS1_5=0;"
        "TS2_1=2628;TS2_2=2627;TS2_3=0;TS2_4=0;TS2_5=0;"
    )
    assert result["TS1"] == ["262", "110", "1", "20", "0"]
    assert result["TS2"] == ["2628", "2627", "0", "0", "0"]
    assert result["StartRef"] == "4010"
    assert result["RelinkTime"] == "30"
    assert result["UserLink"] == "1"
    assert result["CQWW"] == "1"


def test_standard_takes_precedence_over_openspot():
    result = parse_options("TS1=999;TS1_1=262;TS1_2=110;")
    assert result["TS1"] == ["999"]
    assert "TS1_1" not in result
    assert "TS1_2" not in result


def test_openspot_skips_zero_tgs():
    """OpenSpot sends 0 for unused slots; zeros should be preserved as values."""
    result = parse_options("TS1_1=262;TS1_2=0;TS2_1=0;")
    assert result["TS1"] == ["262", "0"]
    assert result["TS2"] == ["0"]


def test_empty_options():
    result = parse_options("")
    assert result["TS1"] == []
    assert result["TS2"] == []


def test_preserves_unknown_keys():
    result = parse_options("TS1=1;FOO=bar;")
    assert result["TS1"] == ["1"]
    assert result["FOO"] == "bar"


def test_normalize_adds_trailing_semicolon():
    assert normalize_options_for_save("TS1=1") == "TS1=1;"


def test_normalize_empty_returns_none():
    assert normalize_options_for_save("") is None
    assert normalize_options_for_save("   ") is None


def test_normalize_rejects_options_wider_than_the_clients_column():
    fits = "TS2=" + "7," * 147 + "7"
    assert len(fits) + 1 == 300
    assert normalize_options_for_save(fits) == fits + ";"
    assert normalize_options_for_save(fits + "7") is None
