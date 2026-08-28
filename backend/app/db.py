"""The one SQLite artifact the service reads: catalogue.sqlite, mounted from /data.

Both the disaster catalogue and the missed-opportunity evaluation live in this
file, so they share region, event and country instead of copying them. Opened
read-only and never written: the service does not own the artifact.
"""

import logging
import sqlite3
from pathlib import Path

from . import config

log = logging.getLogger(__name__)

_con: sqlite3.Connection | None = None


def init() -> None:
    """Open the artifact once; an absent or unreadable file leaves every feed that reads it off."""
    global _con
    path = Path(config.CATALOGUE_DB)
    if not path.exists():
        log.warning("database missing at %s: catalogue and moi feeds disabled", path)
        return
    try:
        # immutable=1 lets SQLite skip locking, which is correct for a read-only bind mount.
        con = sqlite3.connect(f"file:{path}?immutable=1", uri=True, check_same_thread=False)
        con.row_factory = sqlite3.Row
        con.execute("SELECT 1").fetchone()
    except Exception:
        log.exception("database unreadable at %s: catalogue and moi feeds disabled", path)
        return
    _con = con
    log.info("database loaded: %s", path)


def connection() -> sqlite3.Connection | None:
    return _con


def has_table(name: str) -> bool:
    """Whether a build pass has written this table; an older artifact predates the moi_* pass."""
    if _con is None:
        return False
    return _con.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (name,)).fetchone() is not None
