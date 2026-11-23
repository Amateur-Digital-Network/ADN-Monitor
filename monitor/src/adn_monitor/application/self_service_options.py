# ADN Monitor - application self service options
#
# Copyright (C) 2026  Rodrigo Pérez, CE5RPY <ce5rpy@qmd.cl>
#
###############################################################################
#   This program is free software; you can redistribute it and/or modify
#   it under the terms of the GNU General Public License as published by
#   the Free Software Foundation; either version 3 of the License, or
#   (at your option) any later version.
#
#   This program is distributed in the hope that it will be useful,
#   but WITHOUT ANY WARRANTY; without even the implied warranty of
#   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#   GNU General Public License for more details.
#
#   You should have received a copy of the GNU General Public License
#   along with this program; if not, write to the Free Software Foundation,
#   Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA
###############################################################################
#
# Derived from FDMR Monitor (OA4DOA), HBMonv2 (SP2ONG), hbmonitor3 (KC1AWV),
# and HBmonitor (Cortney T. Buffington, N0MJS). Original works under GPLv3.

"""Parse and format Clients.options strings.

Supports two TG formats:
- Standard ADN: ``TS1=262,110;TS2=2628;``
- OpenSpot: ``TS1_1=262;TS1_2=110;TS2_1=2628;``

OpenSpot keys (``TS1_1``..``TS1_9``, ``TS2_1``..``TS2_9``) are collapsed into
the ``TS1`` / ``TS2`` arrays so the dashboard and self-service page see a
single normalized shape. Other OpenSpot parameters (``StartRef``,
``RelinkTime``, ``UserLink``, ``CQWW``) are preserved as-is for round-trip.
"""

from __future__ import annotations

# Width of Clients.options (schema migration 002); longer values would not fit the column.
OPTIONS_MAX_LENGTH = 300

_OPENSLOT_SLOTS = ("TS1", "TS2")


def _parse_openspot_tgs(parsed: dict[str, str], slot: str) -> list[str]:
    """Collect TSx_1..TSx_9 into a list, removing them from parsed."""
    parts: list[str] = []
    for i in range(1, 10):
        key = f"{slot}_{i}"
        val = parsed.pop(key, None)
        if val is not None and val.strip():
            parts.append(val.strip())
    return parts


def parse_options(options: str) -> dict[str, object]:
    out: dict[str, object] = {
        "TS1": [],
        "TS2": [],
        "DIAL": "0",
        "VOICE": "-1",
        "LANG": "0",
        "SINGLE": "-1",
        "TIMER": "0",
    }
    raw: dict[str, str] = {}
    for part in options.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        raw[key.strip()] = value.strip()

    for slot in _OPENSLOT_SLOTS:
        openspot_tgs = _parse_openspot_tgs(raw, slot)
        if slot in raw:
            val = raw.pop(slot)
            out[slot] = [] if val == "" else [x.strip() for x in val.split(",") if x.strip()]
        elif openspot_tgs:
            out[slot] = openspot_tgs

    out.update(raw)
    return out


def normalize_options_for_save(options: str) -> str | None:
    options = options.strip()
    if not options:
        return None
    if not options.endswith(";"):
        options += ";"
    if len(options) > OPTIONS_MAX_LENGTH:
        return None
    return options
