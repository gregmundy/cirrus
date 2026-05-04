"""CLI to load SIGWX files (IWXXM XML or BUFR) into the database."""
import logging
import os
import sys
from pathlib import Path

import psycopg

from cirrus.decoder.sigwx_db import store_sigwx
from cirrus.decoder.sigwx_parser import SigwxFeature, SigwxMetadata, parse_sigwx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("sigwx_load")


def _is_bufr(data: bytes) -> bool:
    """Check if data starts with BUFR magic bytes."""
    return data[:4] == b"BUFR"


def load_sigwx_file(path: Path) -> tuple[SigwxMetadata, list[SigwxFeature]]:
    """Load a SIGWX file, auto-detecting format (XML or BUFR)."""
    data = path.read_bytes()
    if _is_bufr(data):
        from cirrus.decoder.sigwx_bufr_parser import parse_sigwx_bufr
        return parse_sigwx_bufr(data)
    else:
        return parse_sigwx(data)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m cirrus.decoder.sigwx_load <path-to-sigwx-file> [...]")
        print("  Accepts IWXXM XML (.xml) or BUFR (.bufr/.bin) files")
        sys.exit(1)

    database_url = os.environ["DATABASE_URL"]
    conn = psycopg.connect(database_url, autocommit=True)
    logger.info("Connected to database")

    try:
        for path_str in sys.argv[1:]:
            path = Path(path_str)
            if not path.exists():
                logger.error("File not found: %s", path)
                continue

            metadata, features = load_sigwx_file(path)
            count = store_sigwx(conn, path.name, metadata, features)
            logger.info(
                "Loaded %s: %d features (centre=%s, valid=%s)",
                path.name,
                count,
                metadata.originating_centre,
                metadata.phenomenon_time,
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
