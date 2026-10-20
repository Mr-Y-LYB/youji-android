import base64
import io
import json
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from windows import youji_windows as app


with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / "build") as temp:
    app.DATA_DIR = Path(temp)
    app.STATE = app.DATA_DIR / "games.json"
    app.SETTINGS = app.DATA_DIR / "settings.json"
    app.COVERS = app.DATA_DIR / "covers"
    app.prepare()
    server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def api(path, value=None):
        data = None if value is None else json.dumps(value).encode("utf-8")
        request = urllib.request.Request(base + "/api/" + path, data=data,
                                         headers={"X-YouJi-Token": app.TOKEN,
                                                  "Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(request))

    try:
        html = urllib.request.urlopen(base + "/").read().decode("utf-8")
        assert "windows-bridge.js" in html
        assert app.TOKEN in html
        assert api("state")["state"] == app.EMPTY_STATE
        state = json.dumps({"version": 1, "games": [{"id": "g1", "title": "Terraria"}]})
        assert api("state", {"state": state})["ok"]
        assert json.loads(api("state")["state"])["games"][0]["title"] == "Terraria"
        image = io.BytesIO()
        Image.new("RGB", (800, 400), "#0099aa").save(image, "PNG")
        encoded = base64.b64encode(image.getvalue()).decode("ascii")
        assert api("manual-cover", {"id": "g1", "data": encoded})["ok"]
        assert api("manual-cover?id=g1")["data"]
        cover = urllib.request.urlopen(base + "/youji-covers/g1.jpg").read()
        assert Image.open(io.BytesIO(cover)).size == (400, 210)
        assert api("cover-clear", {"id": "g1", "kind": "all"})["ok"]
        assert not (app.COVERS / "manual-g1.jpg").exists()
        print("Windows local storage, asset server and cover checks passed")
    finally:
        server.shutdown()
        server.server_close()
        app.executor.shutdown(wait=False, cancel_futures=True)
