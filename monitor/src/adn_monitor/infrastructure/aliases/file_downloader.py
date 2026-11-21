# ADN Monitor - infrastructure aliases file downloader
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

"""HTTP download + BLAKE2b verification for alias files."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import urllib.request
from pathlib import Path

from ... import USER_AGENT
from ...application.ports import AliasFileDownloaderPort

logger = logging.getLogger("adn-monitor")


class UrllibAliasFileDownloader(AliasFileDownloaderPort):
    def fetch_checksums(self, checksum_url: str, timeout: int = 15) -> dict[str, str] | None:
        try:
            req = urllib.request.Request(checksum_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return {k: v for k, v in data.items() if k != "timestamp" and isinstance(v, str)}
        except Exception as e:
            logger.debug("fetch_checksums failed: %s", e)
            return None

    def download_file(self, url: str, dest_dir: str, file_name: str, timeout: int = 30) -> bool:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            Path(dest_dir).mkdir(parents=True, exist_ok=True)
            (Path(dest_dir) / file_name).write_bytes(data)
            return True
        except Exception as e:
            logger.debug("download_file failed: %s", e)
            return False

    def download_and_verify(
        self,
        dest_dir: str,
        file_name: str,
        url: str,
        checksums: dict[str, str],
    ) -> str:
        if not url:
            return "no url"
        temp_name = file_name + ".tmp"
        if not self.download_file(url, dest_dir, temp_name):
            return "download failed"
        temp_path = Path(dest_dir) / temp_name
        if not temp_path.exists():
            return "download failed (file missing)"
        key = Path(file_name).stem
        expected = checksums.get(key)
        if not expected:
            temp_path.unlink(missing_ok=True)
            return "checksum key missing for " + key
        if not self._verify_blake2b(temp_path, expected):
            temp_path.unlink(missing_ok=True)
            return "checksum verification failed for " + file_name
        final_path = Path(dest_dir) / file_name
        os.replace(temp_path, final_path)
        return "successfully"

    @staticmethod
    def _verify_blake2b(filepath: Path, expected_hex: str) -> bool:
        try:
            h = hashlib.blake2b()
            with filepath.open("rb") as f:
                for chunk in iter(lambda: f.read(4096), b""):
                    h.update(chunk)
            return h.hexdigest() == expected_hex.lower()
        except Exception:
            return False
