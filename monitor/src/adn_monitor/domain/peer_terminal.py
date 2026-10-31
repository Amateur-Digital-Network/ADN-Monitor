# ADN Monitor - peer RF mode (simplex/duplex parity with adn-server)
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

"""ODTP terminals: phone apps and IP terminals that the server shows as peers."""

from __future__ import annotations

from typing import Any


def _text(raw: Any) -> str:
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw or "")


def is_odtp_terminal(peer: dict[str, Any]) -> bool:
    """True for a peer logged in through the ODTP gateway (OPTIONS TERMINAL=1 or package ODTP)."""
    for token in _text(peer.get("OPTIONS")).split(";"):
        key, _, value = token.partition("=")
        if key.strip().upper() == "TERMINAL" and value.strip() == "1":
            return True
    return _text(peer.get("PACKAGE_ID")).strip().upper() == "ODTP"
