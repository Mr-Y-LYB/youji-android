"""Local Windows launcher and API for the shared YouJi interface."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps


VERSION = "1.3.3"
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "YouJi"
ASSETS = ((Path(sys._MEIPASS) / "assets") if hasattr(sys, "_MEIPASS")
          else Path(__file__).resolve().parents[1] / "app/src/main/assets")
STATE = DATA_DIR / "games.json"
SETTINGS = DATA_DIR / "settings.json"
COVERS = DATA_DIR / "covers"
ACHIEVEMENT_ICONS = DATA_DIR / "achievement-icons"
TOKEN = secrets.token_urlsafe(32)
EMPTY_STATE = '{"version":1,"games":[]}'
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
executor = ThreadPoolExecutor(max_workers=2)
icon_executor = ThreadPoolExecutor(max_workers=4)
lock = threading.Lock()
inflight: set[str] = set()
misses: dict[str, float] = {}
events: list[dict] = []
icon_inflight: set[str] = set()


def prepare() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    COVERS.mkdir(parents=True, exist_ok=True)
    ACHIEVEMENT_ICONS.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return default


def write_atomic(path: Path, contents: bytes) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(contents)
    os.replace(temp, path)


def norm(text: str) -> str:
    return "".join(ch for ch in str(text).casefold() if ch.isalnum())


def image_file(game_id: str, kind: str) -> Path:
    return COVERS / f"{kind}-{game_id}.jpg"


def save_image(game_id: str, kind: str, raw: bytes) -> None:
    if not ID_PATTERN.fullmatch(game_id) or len(raw) > 12 * 1024 * 1024:
        raise ValueError("图片无效")
    with Image.open(io.BytesIO(raw)) as source:
        if source.width > 20000 or source.height > 20000:
            raise ValueError("图片尺寸过大")
        source.thumbnail((1600, 1600))
        result = ImageOps.fit(source.convert("RGB"), (400, 210), method=Image.Resampling.LANCZOS)
        out = io.BytesIO()
        result.save(out, format="JPEG", quality=80)
    write_atomic(image_file(game_id, kind), out.getvalue())


def steam_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "YouJi/1.3 Windows", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=9) as response:
        if response.status != 200:
            raise ValueError("Steam 暂不可用")
        return json.loads(response.read(1024 * 1024))


def steam_search(query: str, lang: str = "schinese") -> list[dict]:
    url = ("https://store.steampowered.com/api/storesearch/?term="
           + urllib.parse.quote(query) + "&l=" + lang + "&cc=CN")
    return steam_json(url).get("items", [])[:20]


def steam_achievement_schema(steam_id: int, language: str) -> dict:
    url = f"https://steamcommunity.com/achievements/{steam_id}?l={language}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; YouJi/1.3.3)",
                                                  "Accept": "text/html",
                                                  "Cookie": f"Steam_Language={language}",
                                                  "Accept-Language": "zh-CN,zh;q=0.9" if language == "schinese" else "en-US,en;q=0.9"})
    with urllib.request.urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError("Steam 成就页面暂不可用")
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("成就清单过大")
    html = raw.decode("utf-8")
    match = re.search(r'<script[^>]*id="valve-ssr-data"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise ValueError("Steam 成就页面格式已变化")
    page = json.loads(match.group(1))
    cache = json.loads(page["renderContext"]["queryData"])
    schema = next((query.get("state", {}).get("data") for query in cache["queries"]
                   if query.get("queryKey", [])[:3] == ["achievements", steam_id, "schema"]), None)
    if schema is None:
        raise ValueError("Steam 未提供成就清单")
    return schema


def public_achievements(schema: dict) -> list[dict]:
    return [achievement for group in schema.get("groups", [])
            if not group.get("archived") and group.get("ispublic", True)
            for achievement in group.get("achievements", [])
            if not achievement.get("archived") and achievement.get("name")]


def achievement_key(item: dict) -> str:
    return str(item.get("api_name") or item.get("internal_key") or "")


def steam_achievement_catalog(game: dict) -> dict:
    if str(game.get("platform", "")).lower() != "steam":
        raise ValueError("该平台暂无公开成就清单，请手动添加")
    steam_id = int(game.get("steamId") or 0)
    if steam_id <= 0:
        for title, language in ((game.get("titleEn", ""), "english"),
                                (game.get("title", ""), "schinese")):
            if not title:
                continue
            try:
                match = next((item for item in steam_search(str(title), language)
                              if norm(item.get("name", "")) == norm(str(title))), None)
                if match:
                    steam_id = int(match["id"])
                    break
            except Exception:
                continue
    if steam_id <= 0:
        raise ValueError("未找到对应的 Steam 游戏，请编辑名称后重试")
    english = public_achievements(steam_achievement_schema(steam_id, "english"))
    try:
        chinese_schema = steam_achievement_schema(steam_id, "schinese")
        chinese = {achievement_key(item): item for item in public_achievements(chinese_schema)} \
            if chinese_schema.get("language") == "schinese" else {}
    except Exception:
        chinese = {}
    items = []
    for achievement in english:
        key = achievement_key(achievement)
        if not key:
            continue
        localized = chinese.get(key, {})
        items.append({"key": key, "nameEn": achievement["name"],
                      "descriptionEn": achievement.get("description", ""),
                      "nameZh": localized.get("name", ""),
                      "descriptionZh": localized.get("description", ""),
                      "iconUrl": achievement.get("icon_achieved", "")})
    return {"steamId": steam_id, "items": items}


def find_steam_cover(title: str, title_en: str, steam_id: int) -> tuple[int, str] | None:
    queries = [title_en, title] if title_en and norm(title_en) != norm(title) else [title]
    for query in queries:
        try:
            for item in steam_search(query, "english" if query == title_en else "schinese"):
                candidate_id = int(item.get("id") or 0)
                exact = norm(item.get("name", "")) in {norm(title), norm(title_en)}
                if candidate_id > 0 and (candidate_id == steam_id or steam_id <= 0 and exact):
                    url = item.get("tiny_image", "")
                    if trusted_image(url):
                        return candidate_id, url
        except Exception:
            continue
    if steam_id > 0:
        try:
            info = steam_json(f"https://store.steampowered.com/api/appdetails?appids={steam_id}&l=english&cc=US")
            url = info.get(str(steam_id), {}).get("data", {}).get("header_image", "")
            if trusted_image(url):
                return steam_id, url
        except Exception:
            pass
    return None


def trusted_image(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "steamstatic.com" or host.endswith(".steamstatic.com"))


def achievement_icon_file(game_id: str, key: str) -> Path:
    digest = hashlib.sha256((game_id + "\n" + key).encode("utf-8")).hexdigest()
    return ACHIEVEMENT_ICONS / f"{digest}.jpg"


def fetch_achievement_icon(game_id: str, key: str, url: str) -> None:
    token = game_id + "\n" + key
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "YouJi/1.3.3 Windows"})
        with urllib.request.urlopen(request, timeout=12) as response:
            if not trusted_image(response.url) or not response.headers.get_content_type().startswith("image/"):
                return
            raw = response.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            return
        with Image.open(io.BytesIO(raw)) as source:
            if source.width > 4096 or source.height > 4096:
                return
            output = io.BytesIO()
            ImageOps.fit(source.convert("RGB"), (80, 80), method=Image.Resampling.LANCZOS).save(output, "JPEG", quality=85)
        write_atomic(achievement_icon_file(game_id, key), output.getvalue())
        with lock:
            events.append({"kind": "achievement-icon", "id": game_id, "key": key})
    except Exception:
        pass
    finally:
        with lock:
            icon_inflight.discard(token)


def queue_achievement_icons(game: dict) -> None:
    game_id = str(game.get("id", ""))
    if not ID_PATTERN.fullmatch(game_id):
        return
    for item in game.get("items", [])[:1000]:
        if not isinstance(item, dict):
            continue
        key, url = str(item.get("key", "")), str(item.get("iconUrl", ""))
        token = game_id + "\n" + key
        if not key or len(key) > 200 or not trusted_image(url) or achievement_icon_file(game_id, key).is_file():
            continue
        with lock:
            if token in icon_inflight:
                continue
            icon_inflight.add(token)
        icon_executor.submit(fetch_achievement_icon, game_id, key, url)


def fetch_cover(game: dict) -> None:
    game_id = game["id"]
    try:
        found = find_steam_cover(game["title"], game.get("titleEn", ""), int(game.get("steamId") or 0))
        if not found:
            misses[game_id + ":" + norm(game["title"])] = time.time()
            return
        steam_id, url = found
        request = urllib.request.Request(url, headers={"User-Agent": "YouJi/1.3 Windows"})
        with urllib.request.urlopen(request, timeout=12) as response:
            if not trusted_image(response.url) or not response.headers.get_content_type().startswith("image/"):
                return
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            return
        save_image(game_id, "auto", raw)
        with lock:
            events.append({"id": game_id, "steamId": steam_id})
    except Exception:
        pass
    finally:
        with lock:
            inflight.discard(game_id)


def queue_covers(games: list[dict]) -> None:
    for game in games[:100]:
        if not isinstance(game, dict):
            continue
        game_id = str(game.get("id", ""))
        title = str(game.get("title", ""))
        if (not ID_PATTERN.fullmatch(game_id) or not title or len(title) > 160
                or image_file(game_id, "manual").exists()
                or image_file(game_id, "auto").exists()):
            continue
        if not game.get("force") and time.time() - misses.get(game_id + ":" + norm(title), 0) < 7 * 24 * 3600:
            continue
        with lock:
            if game_id in inflight:
                continue
            inflight.add(game_id)
        executor.submit(fetch_cover, {"id": game_id, "title": title,
                                      "titleEn": str(game.get("titleEn", ""))[:160],
                                      "steamId": game.get("steamId") or 0})


def excel_rows(raw: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(raw)) as book:
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            if book.getinfo("xl/sharedStrings.xml").file_size > 10 * 1024 * 1024:
                raise ValueError("Excel 文件过大")
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.findall(".//m:t", ns))
                      for si in root.findall("m:si", ns)]
        sheet_name = next((name for name in book.namelist()
                           if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)), None)
        if not sheet_name:
            raise ValueError("找不到 Excel 工作表")
        if book.getinfo(sheet_name).file_size > 10 * 1024 * 1024:
            raise ValueError("Excel 工作表过大")
        root = ET.fromstring(book.read(sheet_name))
        rows = []
        for row in root.findall(".//m:sheetData/m:row", ns)[:10001]:
            values = []
            for cell in row.findall("m:c", ns):
                match = re.match(r"[A-Z]+", cell.attrib.get("r", ""))
                if not match:
                    continue
                col = 0
                for ch in match.group():
                    col = col * 26 + ord(ch) - ord("A") + 1
                if col > 100:
                    continue
                while len(values) < col:
                    values.append("")
                value = cell.findtext("m:v", "", ns)
                if cell.attrib.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                    value = shared[int(value)]
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall(".//m:t", ns))
                values[col - 1] = value
            rows.append(values)
        return rows


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def send_bytes(self, body: bytes, mime: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value: dict, status: int = 200) -> None:
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def authorized(self) -> bool:
        return self.headers.get("X-YouJi-Token") == TOKEN

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            if not self.authorized():
                self.send_json({"error": "Forbidden"}, 403)
                return
            if path == "/api/state":
                try:
                    state = STATE.read_text(encoding="utf-8")
                except OSError:
                    state = EMPTY_STATE
                self.send_json({"state": state})
            elif path == "/api/seen-version":
                self.send_json({"version": read_json(SETTINGS, {}).get("seenVersion", "")})
            elif path == "/api/manual-cover":
                game_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
                raw = image_file(game_id, "manual").read_bytes() if ID_PATTERN.fullmatch(game_id) and image_file(game_id, "manual").is_file() else b""
                self.send_json({"data": base64.b64encode(raw).decode("ascii")})
            elif path == "/api/cover-events":
                with lock:
                    pending = events[:]
                    events.clear()
                self.send_json({"events": pending})
            else:
                self.send_json({"error": "Not found"}, 404)
            return
        if path.startswith("/youji-covers/"):
            match = re.fullmatch(r"/youji-covers/([A-Za-z0-9_-]{1,80})\.jpg", path)
            if match:
                game_id = match.group(1)
                cover = image_file(game_id, "manual")
                if not cover.is_file():
                    cover = image_file(game_id, "auto")
                if cover.is_file():
                    self.send_bytes(cover.read_bytes(), "image/jpeg")
                    return
            self.send_bytes(b"", "text/plain", 404)
            return
        if path == "/youji-achievements/icon.jpg":
            query = urllib.parse.parse_qs(parsed.query)
            game_id, key = query.get("game", [""])[0], query.get("key", [""])[0]
            if ID_PATTERN.fullmatch(game_id) and key and len(key) <= 200:
                target = achievement_icon_file(game_id, key)
                if target.is_file():
                    self.send_bytes(target.read_bytes(), "image/jpeg")
                    return
            self.send_bytes(b"", "text/plain", 404)
            return
        filename = "index.html" if path == "/" else path.lstrip("/")
        if filename not in {"index.html", "app.js", "catalog.js", "style.css", "windows-bridge.js"}:
            self.send_bytes(b"", "text/plain", 404)
            return
        try:
            raw = (ASSETS / filename).read_bytes()
            if filename == "index.html":
                raw = raw.replace(b"<head>", b"<head><meta name=\"youji-token\" content=\"" + TOKEN.encode("ascii") + b"\">")
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            self.send_bytes(raw, mime + "; charset=utf-8" if mime.startswith("text/") or mime == "application/javascript" else mime)
        except OSError:
            self.send_bytes(b"", "text/plain", 404)

    def do_POST(self) -> None:
        if not self.path.startswith("/api/") or not self.authorized():
            self.send_json({"error": "Forbidden"}, 403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 30 * 1024 * 1024:
                raise ValueError("文件过大（上限 30 MB）")
            raw = self.rfile.read(size)
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/import-file":
                name = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("name", ["文件"])[0]
                if name.lower().endswith(".xlsx") or raw.startswith(b"PK\x03\x04"):
                    self.send_json({"name": name, "rows": excel_rows(raw)})
                else:
                    self.send_json({"name": name, "text": raw.decode("utf-8-sig")})
                return
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                raise ValueError("请求无效")
            request = json.loads(raw or b"{}")
            if path == "/api/state":
                value = request.get("state", "")
                parsed = json.loads(value)
                if not isinstance(parsed.get("games"), list) or len(value.encode("utf-8")) > 10 * 1024 * 1024:
                    raise ValueError("记录数据无效")
                write_atomic(STATE, value.encode("utf-8"))
                self.send_json({"ok": True})
            elif path == "/api/seen-version":
                value = str(request.get("version", ""))[:30]
                write_atomic(SETTINGS, json.dumps({"seenVersion": value}).encode("utf-8"))
                self.send_json({"ok": True})
            elif path == "/api/covers":
                queue_covers(request.get("games", []))
                self.send_json({"ok": True})
            elif path == "/api/achievement-icons":
                queue_achievement_icons(request.get("game", {}))
                self.send_json({"ok": True})
            elif path == "/api/cover-clear":
                game_id = str(request.get("id", ""))
                if ID_PATTERN.fullmatch(game_id):
                    for kind in (["auto", "manual"] if request.get("kind") == "all" else [request.get("kind", "")]):
                        if kind in {"auto", "manual"}:
                            image_file(game_id, kind).unlink(missing_ok=True)
                    misses.pop(game_id + ":" + norm(request.get("title", "")), None)
                self.send_json({"ok": True})
            elif path == "/api/manual-cover":
                game_id = str(request.get("id", ""))
                data = str(request.get("data", ""))
                if len(data) > 16 * 1024 * 1024:
                    raise ValueError("图片过大")
                save_image(game_id, "manual", base64.b64decode(data, validate=True))
                self.send_json({"ok": True})
            elif path == "/api/search":
                query = str(request.get("query", ""))[:80]
                items = steam_search(query)[:12] if len(query.strip()) >= 2 else []
                self.send_json({"requestId": request.get("requestId"), "results": [
                    {"title": item.get("name", ""), "titleEn": "", "steamId": item.get("id", 0), "source": "Steam 商店"}
                    for item in items if item.get("id") and item.get("name")], "error": ""})
            elif path == "/api/english":
                steam_id = int(request.get("steamId") or 0)
                title_en = ""
                if steam_id > 0:
                    result = steam_json(f"https://store.steampowered.com/api/appdetails?appids={steam_id}&l=english&cc=US")
                    title_en = result.get(str(steam_id), {}).get("data", {}).get("name", "")
                self.send_json({"requestId": request.get("requestId"), "title": request.get("title", ""), "titleEn": title_en})
            elif path == "/api/achievements":
                game = request.get("game", {})
                result = steam_achievement_catalog(game)
                self.send_json({"id": game.get("id", ""), "platform": game.get("platform", ""),
                                "title": game.get("title", ""), **result})
            elif path == "/api/update":
                release = None
                for url in (
                    "https://api.github.com/repos/Mr-Y-LYB/youji-android/releases/latest",
                    "https://raw.githubusercontent.com/Mr-Y-LYB/youji-android/main/update.json",
                    "https://cdn.jsdelivr.net/gh/Mr-Y-LYB/youji-android@main/update.json",
                ):
                    try:
                        candidate = steam_json(url)
                        if candidate.get("tag_name") and isinstance(candidate.get("assets"), list):
                            release = candidate
                            break
                    except Exception:
                        continue
                if release is None:
                    raise ValueError("更新服务暂不可用")
                latest = str(release.get("tag_name", "")).lstrip("v")
                available = latest and tuple(map(int, latest.split("."))) > tuple(map(int, VERSION.split(".")))
                asset = next((item for item in release.get("assets", []) if item.get("name", "").lower().endswith(".zip") and "windows" in item.get("name", "").lower()), None)
                self.send_json({"manual": bool(request.get("manual")), "available": bool(available and asset),
                                "version": latest, "url": asset.get("browser_download_url", "") if asset else "",
                                "digest": asset.get("digest", "") if asset else "",
                                "notes": release.get("body", "")[:800]})
            else:
                self.send_json({"error": "Not found"}, 404)
        except Exception as exc:
            self.send_json({"error": str(exc)[:160]}, 400)


def edge_path() -> Path | None:
    candidates = [Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe",
                  Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft/Edge/Application/msedge.exe"]
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def main() -> int:
    if "--self-test" in sys.argv:
        assert (ASSETS / "index.html").is_file()
        assert (ASSETS / "windows-bridge.js").is_file()
        assert Image.new("RGB", (1, 1)).size == (1, 1)
        return 0
    prepare()
    edge = edge_path()
    if edge is None:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, "需要安装 Microsoft Edge 才能运行游迹。", "游迹", 0x10)
        return 1
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    profile = DATA_DIR / "EdgeProfile"
    command = [str(edge), "--no-first-run", "--disable-features=msEdgeSidebarV2",
               "--app=" + url, "--user-data-dir=" + str(profile), "--window-size=600,830"]
    try:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process.wait()
    finally:
        server.shutdown()
        executor.shutdown(wait=False, cancel_futures=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        import ctypes
        try:
            prepare()
            (DATA_DIR / "last-error.txt").write_text(str(error), encoding="utf-8")
        except OSError:
            pass
        ctypes.windll.user32.MessageBoxW(None, "游迹启动失败：" + str(error), "游迹", 0x10)
        raise SystemExit(1)
