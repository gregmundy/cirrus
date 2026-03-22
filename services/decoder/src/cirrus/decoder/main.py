import json
import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import psycopg

from cirrus.decoder import db, grib_decoder

SERVICE_NAME = "decoder"
PORT = 8090
logger = logging.getLogger(SERVICE_NAME)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok", "service": "decoder"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    server.serve_forever()


def handle_notification(conn: psycopg.Connection, payload: str) -> None:
    """Process a single decoder_jobs notification."""
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        logger.error("Invalid JSON in notification payload: %s", payload)
        return

    download_id = data.get("download_id")
    file_path = data.get("file_path")
    if download_id is None or file_path is None:
        logger.error("Missing fields in notification payload: %s", payload)
        return

    logger.info("Processing download_id=%d file=%s", download_id, file_path)

    info = db.get_download_info(conn, download_id)
    if info is None:
        logger.error("Download ID %d not found in database", download_id)
        return

    if not os.path.exists(file_path):
        logger.error("GRIB2 file not found: %s", file_path)
        return

    fields = grib_decoder.decode_file(
        file_path, download_id, info["run_time"], info["forecast_hour"]
    )

    if not fields:
        logger.warning("No fields decoded from %s", file_path)
        return

    count = db.insert_fields(conn, fields)
    logger.info("Inserted %d field(s) for download_id=%d", count, download_id)

    db.mark_decoded(conn, download_id)
    logger.info("Marked download_id=%d as decoded", download_id)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    database_url = os.environ["DATABASE_URL"]

    # Two connections: one for LISTEN (must stay idle), one for queries/inserts.
    # psycopg3's conn.notifies() holds the connection in a notification-listening
    # state — calling conn.execute() on the same connection inside the generator
    # loop will deadlock.
    listen_conn = psycopg.connect(database_url, autocommit=True)
    work_conn = psycopg.connect(database_url, autocommit=True)
    logger.info("%s connected to database", SERVICE_NAME)

    health_thread = Thread(target=start_health_server, daemon=True)
    health_thread.start()
    logger.info("%s health server on port %d", SERVICE_NAME, PORT)

    listen_conn.execute("LISTEN decoder_jobs")
    logger.info("%s listening for notifications on decoder_jobs", SERVICE_NAME)

    # Process any un-decoded downloads from before this process started
    unprocessed = work_conn.execute(
        "SELECT id, file_path FROM grib_downloads WHERE decoded = FALSE ORDER BY id"
    ).fetchall()
    for row in unprocessed:
        download_id, file_path = row
        logger.info("Processing backlog: download_id=%d", download_id)
        handle_notification(work_conn, json.dumps({"download_id": download_id, "file_path": file_path}))

    # Main notification loop
    while True:
        gen = listen_conn.notifies(timeout=5.0)
        for notify in gen:
            handle_notification(work_conn, notify.payload)


if __name__ == "__main__":
    main()
