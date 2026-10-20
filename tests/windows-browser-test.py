import subprocess
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from windows import youji_windows as app


workspace = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(dir=workspace / "build") as temp:
    root = Path(temp).resolve()
    assert root.is_relative_to(workspace.resolve())
    app.DATA_DIR = root / "data"
    app.STATE = app.DATA_DIR / "games.json"
    app.SETTINGS = app.DATA_DIR / "settings.json"
    app.COVERS = app.DATA_DIR / "covers"
    app.prepare()
    server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/"
        command = [str(app.edge_path()), "--headless=new", "--disable-gpu", "--no-first-run",
                   "--no-default-browser-check", "--user-data-dir=" + str(root / "edge"),
                   "--virtual-time-budget=3500", "--dump-dom", url]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=35)
        assert result.returncode == 0, result.stderr[-500:]
        assert 'class="page-title compact-title">更新说明' in result.stdout, result.stdout[-1000:]
        assert 'class="setting-action"' not in result.stdout
        print("Windows browser rendering check passed")
    finally:
        server.shutdown()
        server.server_close()
        app.executor.shutdown(wait=False, cancel_futures=True)
