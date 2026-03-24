"""CLI to load SIGWX IWXXM XML files into the database."""
import logging
import os
import sys
from pathlib import Path

import psycopg

from cirrus.decoder.sigwx_db import store_sigwx
from cirrus.decoder.sigwx_parser import parse_sigwx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("sigwx_load")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m cirrus.decoder.sigwx_load <path-to-iwxxm-xml> [...]")
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

            xml_bytes = path.read_bytes()
            metadata, features = parse_sigwx(xml_bytes)
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
