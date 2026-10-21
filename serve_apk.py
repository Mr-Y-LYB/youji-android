"""Temporarily serve the built APK to a phone on the same local network."""

import argparse
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


DIST = Path(__file__).resolve().parent / "dist"
APKS = sorted(DIST.glob("游迹-v*.apk"), key=lambda file: file.stat().st_mtime)
APK = APKS[-1] if APKS else DIST / "missing.apk"


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.respond(False)

    def do_GET(self):
        self.respond(True)

    def respond(self, send_body):
        if urlsplit(self.path).path != "/youji.apk":
            self.send_error(404)
            return
        if not APK.is_file():
            self.send_error(404, "APK is not built")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.android.package-archive")
        self.send_header("Content-Length", str(APK.stat().st_size))
        self.send_header("Content-Disposition", f'attachment; filename="YouJi-{APK.stem.split("-v")[-1]}.apk"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if send_body:
            with APK.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    self.wfile.write(chunk)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--seconds", type=int, default=7200)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    timer = threading.Timer(args.seconds, server.shutdown)
    timer.daemon = True
    timer.start()
    print(f"Serving http://{args.host}:{args.port}/youji.apk for {args.seconds} seconds", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
