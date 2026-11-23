# ADN Monitor - infrastructure persistence sync mysql
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

"""Synchronous MySQL connections for FastAPI REST (no Twisted reactor)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import MySQLdb
from MySQLdb.constants import CLIENT


class SyncMysqlPool:
    """Thin wrapper around short-lived MySQL connections."""

    def __init__(self, db_config: dict[str, Any]) -> None:
        self._host = str(db_config.get("SERVER", "localhost"))
        self._user = str(db_config.get("USER", ""))
        self._passwd = str(db_config.get("PASSWD", ""))
        self._db = str(db_config.get("NAME", ""))
        self._port = int(db_config.get("PORT", 3306))

    def connect(self) -> Any:
        return MySQLdb.connect(
            host=self._host,
            user=self._user,
            passwd=self._passwd,
            db=self._db,
            port=self._port,
            charset="utf8mb4",
            # rowcount counts matched rows, so re-saving identical values is not "no row updated".
            client_flag=CLIENT.FOUND_ROWS,
        )

    @contextmanager
    def connection(self, *, autocommit: bool = True) -> Iterator[Any]:
        conn = self.connect()
        try:
            yield conn
            if autocommit:
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
