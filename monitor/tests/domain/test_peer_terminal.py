"""ODTP terminals are told apart from hotspots."""

from adn_monitor.application.hblink_table import add_hb_peer
from adn_monitor.domain.peer_terminal import is_odtp_terminal


def test_terminal_option_or_odtp_package_marks_a_terminal():
    assert is_odtp_terminal({"OPTIONS": b"TERMINAL=1;TS2=9990"})
    assert is_odtp_terminal({"OPTIONS": "ts2=214; terminal = 1"})
    assert is_odtp_terminal({"PACKAGE_ID": b"ODTP"})


def test_hotspots_are_not_terminals():
    assert not is_odtp_terminal({"OPTIONS": b"TS2=214;TERMINAL=0", "PACKAGE_ID": b"MMDVM_HS_Dual_Hat"})
    assert not is_odtp_terminal({})


def test_ctable_flags_only_terminals():
    table = {}
    for pid, conf in ((213003598, {"PACKAGE_ID": b"ODTP", "OPTIONS": b"TERMINAL=1"}), (213003501, {"PACKAGE_ID": b"MMDVM"})):
        add_hb_peer(conf, table, pid, lambda *_: "", int)
    assert table[213003598]["TERMINAL"] is True
    assert "TERMINAL" not in table[213003501]
