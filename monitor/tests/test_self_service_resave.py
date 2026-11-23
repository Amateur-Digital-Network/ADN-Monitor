"""Saving the same self-service options twice still counts as an update."""

from __future__ import annotations

from typing import Any

import pytest
from MySQLdb.constants import CLIENT

from adn_monitor.infrastructure.persistence import sync_mysql
from adn_monitor.infrastructure.persistence.sync_mysql import SyncMysqlPool
from adn_monitor.infrastructure.repositories.clients_device_repository import MysqlDeviceRepository


class _ClientsTable:
    """One Clients row, with MySQL's rowcount rule: changed rows unless FOUND_ROWS asks for matched."""

    def __init__(self) -> None:
        self.row = {"int_id": 7, "options": "", "modified": 0}

    def connect(self, *, client_flag: int = 0, **_: Any) -> _Connection:
        return _Connection(self, found_rows=bool(client_flag & CLIENT.FOUND_ROWS))


class _Connection:
    def __init__(self, table: _ClientsTable, *, found_rows: bool) -> None:
        self._table = table
        self._found_rows = found_rows

    def cursor(self) -> _Cursor:
        return _Cursor(self._table, self._found_rows)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


class _Cursor:
    def __init__(self, table: _ClientsTable, found_rows: bool) -> None:
        self._table = table
        self._found_rows = found_rows
        self.rowcount = -1

    def execute(self, sql: str, args: tuple[Any, ...]) -> None:
        assert sql.startswith("UPDATE Clients SET options = %s, modified = 1")
        options, int_id = args
        row = self._table.row
        if row["int_id"] != int_id:
            self.rowcount = 0
            return
        changed = (row["options"], row["modified"]) != (options, 1)
        row.update(options=options, modified=1)
        self.rowcount = 1 if changed or self._found_rows else 0


@pytest.fixture
def repo(monkeypatch: pytest.MonkeyPatch) -> MysqlDeviceRepository:
    monkeypatch.setattr(sync_mysql, "MySQLdb", _ClientsTable())
    return MysqlDeviceRepository(SyncMysqlPool({"NAME": "hbmon"}))


def test_resaving_options_before_the_server_applies_them_is_still_an_update(
    repo: MysqlDeviceRepository,
) -> None:
    assert repo.update_options(7, "TS2=730;") == 1
    assert repo.update_options(7, "TS2=730;") == 1


def test_unknown_device_is_not_an_update(repo: MysqlDeviceRepository) -> None:
    assert repo.update_options(8, "TS2=730;") == 0
