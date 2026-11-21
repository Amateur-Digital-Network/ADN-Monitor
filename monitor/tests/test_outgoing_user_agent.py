"""Every outgoing request names the monitor and its version."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from adn_monitor import __version__
from adn_monitor.domain.result import is_ok
from adn_monitor.infrastructure.aliases.file_downloader import UrllibAliasFileDownloader
from adn_monitor.infrastructure.http.httpx_fetcher import HttpxFetcher

_EXPECTED = f"adn-monitor/{__version__}"


@pytest.fixture
def origin() -> Iterator[tuple[list[Message], str]]:
    seen: list[Message] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            seen.append(self.headers)
            body = b'{"peer_ids": "x"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield seen, f"http://127.0.0.1:{server.server_address[1]}/file_checksums.json"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_alias_downloads_send_the_monitor_user_agent(
    tmp_path: Path, origin: tuple[list[Message], str]
) -> None:
    seen, url = origin
    downloader = UrllibAliasFileDownloader()
    assert downloader.fetch_checksums(url) is not None
    assert downloader.download_file(url, str(tmp_path), "peer_ids.json")
    assert [h.get("User-Agent") for h in seen] == [_EXPECTED, _EXPECTED]


def test_http_fetcher_sends_the_monitor_user_agent(origin: tuple[list[Message], str]) -> None:
    seen, url = origin
    assert is_ok(HttpxFetcher().fetch(url))
    assert seen[0].get("User-Agent") == _EXPECTED
