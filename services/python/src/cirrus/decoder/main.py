import logging
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import psycopg

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
        pass  # suppress default logging


def start_health_server():
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    server.serve_forever()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    database_url = os.environ["DATABASE_URL"]

    conn = psycopg.connect(database_url, autocommit=True)
    logger.info(f"{SERVICE_NAME} connected to database")

    # Start health check server in background thread
    health_thread = Thread(target=start_health_server, daemon=True)
    health_thread.start()
    logger.info(f"{SERVICE_NAME} health server on port {PORT}")

    # Listen for notifications (no handlers yet)
    conn.execute(f"LISTEN {SERVICE_NAME}_jobs")
    logger.info(f"{SERVICE_NAME} listening for notifications on {SERVICE_NAME}_jobs")

    while True:
        # Wait for notifications, timeout every 5s to keep the loop alive
        gen = conn.notifies(timeout=5.0)
        for notify in gen:
            logger.info(f"Received notification: {notify.channel} -> {notify.payload}")


if __name__ == "__main__":
    main()
