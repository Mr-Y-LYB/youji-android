package com.youji.gamejournal;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;
import android.graphics.Rect;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import javax.xml.parsers.DocumentBuilderFactory;

public class MainActivity extends Activity {
    private static final int PICK_IMPORT = 101;
    private static final int PICK_EXPORT = 102;
    private static final int PICK_SCREENSHOT = 103;
    private static final int PICK_COVER = 104;
    private static final int PICK_ACHIEVEMENT_ICON = 105;
    private static final int MAX_IMPORT_BYTES = 10 * 1024 * 1024;
    private static final int MAX_BACKUP_BYTES = 30 * 1024 * 1024;
    private WebView web;
    private String pendingExport;
    private String pendingCoverId;
    private String pendingAchievementGameId;
    private String pendingAchievementKey;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService achievementWorker = Executors.newFixedThreadPool(2);
    private UpdateManager updater;
    private CoverManager covers;
    private AchievementIconManager icons;
    private boolean pageReady;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(10, 14, 25));
        getWindow().setNavigationBarColor(Color.rgb(10, 14, 25));
        updater = new UpdateManager(this, worker, this::callback);
        covers = new CoverManager(this, this::callback);
        icons = new AchievementIconManager(this, this::callback);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(true);
        web.getSettings().setAllowFileAccessFromFileURLs(false);
        web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"file".equals(request.getUrl().getScheme());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse cover = covers.response(request.getUrl());
                return cover != null ? cover : icons.response(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                updater.check(false);
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    private void callback(String name, String jsonArgument) {
        runOnUiThread(() -> web.evaluateJavascript("window." + name + "(" + jsonArgument + ")", null));
    }

    private File stateFile() { return new File(getFilesDir(), "games.json"); }

    @Override protected void onResume() {
        super.onResume();
        if (updater != null) {
            updater.resumePendingInstall();
            if (pageReady) updater.check(false);
        }
    }

    public class Bridge {
        @JavascriptInterface public void ensureCovers(String gamesJson) {
            covers.ensure(gamesJson);
        }

        @JavascriptInterface public void ensureAchievementIcons(String gameJson) {
            icons.ensure(gameJson);
        }

        @JavascriptInterface public void pickAchievementIcon(String gameId, String key) {
            runOnUiThread(() -> {
                pendingAchievementGameId = gameId;
                pendingAchievementKey = key;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                startActivityForResult(intent, PICK_ACHIEVEMENT_ICON);
            });
        }

        @JavascriptInterface public void pickCover(String gameId) {
            runOnUiThread(() -> {
                pendingCoverId = gameId;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                startActivityForResult(intent, PICK_COVER);
            });
        }

        @JavascriptInterface public String getManualCoverData(String gameId) {
            return covers.manualData(gameId);
        }

        @JavascriptInterface public boolean saveManualCover(String gameId, String base64) {
            return covers.saveManual(gameId, base64);
        }

        @JavascriptInterface public void clearAutoCover(String gameId) {
            covers.clearAuto(gameId);
        }

        @JavascriptInterface public void clearManualCover(String gameId) {
            covers.clearManual(gameId);
        }

        @JavascriptInterface public void clearCover(String gameId) {
            covers.clearAll(gameId);
        }

        @JavascriptInterface public void checkForUpdates(boolean manual) {
            updater.check(manual);
        }

        @JavascriptInterface public void downloadUpdate(String url, String digest, String version) {
            updater.download(url, digest, version);
        }

        @JavascriptInterface public String getSeenVersion() {
            return getPreferences(MODE_PRIVATE).getString("seen_version", "");
        }

        @JavascriptInterface public void markVersionSeen(String version) {
            getPreferences(MODE_PRIVATE).edit().putString("seen_version", version).apply();
        }

        @JavascriptInterface public String loadState() {
            try {
                File file = stateFile();
                if (!file.exists()) return "{\"version\":1,\"games\":[]}";
                return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            } catch (Exception e) { return "{\"version\":1,\"games\":[]}"; }
        }

        @JavascriptInterface public synchronized boolean saveState(String json) {
            if (json == null || json.length() > MAX_IMPORT_BYTES) return false;
            try {
                JSONObject parsed = new JSONObject(json);
                if (!parsed.has("games") || !(parsed.get("games") instanceof JSONArray)) return false;
                File target = stateFile();
                File temp = new File(getFilesDir(), "games.tmp");
                try (FileOutputStream out = new FileOutputStream(temp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (!temp.renameTo(target)) {
                    Files.move(temp.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface public void pickImport() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "text/csv", "text/tab-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/html", "application/octet-stream"});
                startActivityForResult(intent, PICK_IMPORT);
            });
        }

        @JavascriptInterface public void pickScreenshot() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                startActivityForResult(intent, PICK_SCREENSHOT);
            });
        }

        @JavascriptInterface public void exportBackup(String json) {
            if (json == null || json.length() > MAX_BACKUP_BYTES) return;
            pendingExport = json;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "游迹备份-" + java.time.LocalDate.now() + ".json");
                startActivityForResult(intent, PICK_EXPORT);
            });
        }

        @JavascriptInterface public void searchOnline(String query, int requestId) {
            if (query == null || query.trim().length() < 2 || query.length() > 80) return;
            worker.execute(() -> {
                JSONArray results = new JSONArray();
                String error = "";
                try {
                    String url = "https://store.steampowered.com/api/storesearch/?term="
                        + java.net.URLEncoder.encode(query.trim(), "UTF-8") + "&l=schinese&cc=CN";
                    JSONObject data = new JSONObject(getHttps(url));
                    JSONArray items = data.optJSONArray("items");
                    if (items != null) {
                        for (int i = 0; i < Math.min(items.length(), 12); i++) {
                            JSONObject item = items.optJSONObject(i);
                            if (item == null) continue;
                            int appId = item.optInt("id", 0);
                            String title = item.optString("name", "");
                            if (appId <= 0 || title.isEmpty()) continue;
                            JSONObject result = new JSONObject();
                            result.put("title", title);
                            result.put("titleEn", "");
                            result.put("steamId", appId);
                            result.put("source", "Steam 商店");
                            results.put(result);
                        }
                    }
                } catch (Exception e) { error = "联网搜索暂不可用，请使用本地建议或手动输入"; }
                JSONObject response = new JSONObject();
                try { response.put("requestId", requestId); response.put("results", results); response.put("error", error); } catch (Exception ignored) {}
                callback("onOnlineResults", response.toString());
            });
        }

        @JavascriptInterface public void resolveEnglish(int steamId, String chineseTitle, int requestId) {
            if (steamId <= 0) return;
            worker.execute(() -> {
                JSONObject result = new JSONObject();
                try {
                    String url = "https://store.steampowered.com/api/appdetails?appids=" + steamId + "&l=english&cc=US";
                    JSONObject root = new JSONObject(getHttps(url));
                    JSONObject app = root.optJSONObject(String.valueOf(steamId));
                    JSONObject detail = app == null ? null : app.optJSONObject("data");
                    result.put("titleEn", detail == null ? "" : detail.optString("name", ""));
                } catch (Exception e) { try { result.put("titleEn", ""); } catch (Exception ignored) {} }
                try { result.put("requestId", requestId); result.put("title", chineseTitle); } catch (Exception ignored) {}
                callback("onEnglishResolved", result.toString());
            });
        }

        @JavascriptInterface public void fetchAchievements(String gameJson) {
            achievementWorker.execute(() -> {
                JSONObject response = new JSONObject();
                try {
                    JSONObject game = new JSONObject(gameJson);
                    response.put("id", game.optString("id", ""));
                    response.put("platform", game.optString("platform", ""));
                    response.put("title", game.optString("title", ""));
                    JSONObject result = AchievementCatalog.fetch(game);
                    response.put("steamId", result.getInt("steamId"));
                    response.put("items", result.getJSONArray("items"));
                } catch (Exception e) {
                    try { response.put("error", e.getMessage() == null ? "成就读取失败" : e.getMessage()); }
                    catch (Exception ignored) {}
                }
                callback("onAchievementsLoaded", response.toString());
            });
        }
    }

    private static String getHttps(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(6000);
        conn.setReadTimeout(6000);
        conn.setRequestProperty("User-Agent", "YouJi/1.0 Android");
        conn.setRequestProperty("Accept", "application/json");
        try {
            if (conn.getResponseCode() != 200) throw new IllegalStateException("HTTP " + conn.getResponseCode());
            try (InputStream input = conn.getInputStream()) {
                return new String(readLimited(input, 1024 * 1024), StandardCharsets.UTF_8);
            }
        } finally { conn.disconnect(); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        String coverId = request == PICK_COVER ? pendingCoverId : null;
        if (request == PICK_COVER) pendingCoverId = null;
        String iconGameId = request == PICK_ACHIEVEMENT_ICON ? pendingAchievementGameId : null;
        String iconKey = request == PICK_ACHIEVEMENT_ICON ? pendingAchievementKey : null;
        if (request == PICK_ACHIEVEMENT_ICON) {
            pendingAchievementGameId = null;
            pendingAchievementKey = null;
        }
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (request == PICK_COVER) {
            covers.importManual(coverId, uri);
        } else if (request == PICK_ACHIEVEMENT_ICON) {
            worker.execute(() -> {
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("无法读取图片");
                    byte[] encoded = AchievementIconManager.squareJpeg(readLimited(input, 12 * 1024 * 1024));
                    JSONObject event = new JSONObject();
                    event.put("id", iconGameId);
                    event.put("key", iconKey);
                    event.put("data", "data:image/jpeg;base64," + android.util.Base64.encodeToString(encoded, android.util.Base64.NO_WRAP));
                    callback("onManualAchievementIconReady", event.toString());
                } catch (Exception e) { callback("onAchievementIconError", JSONObject.quote("图标读取失败")); }
            });
        } else if (request == PICK_EXPORT) {
            String content = pendingExport;
            pendingExport = null;
            worker.execute(() -> {
                boolean ok = false;
                try (java.io.OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    if (out != null && content != null) { out.write(content.getBytes(StandardCharsets.UTF_8)); ok = true; }
                } catch (Exception ignored) {}
                callback("onExportFinished", ok ? "true" : "false");
            });
        } else if (request == PICK_SCREENSHOT) {
            try {
                InputImage image = InputImage.fromFilePath(this, uri);
                TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
                recognizer.process(image)
                    .addOnSuccessListener(visionText -> {
                        JSONArray lines = new JSONArray();
                        for (Text.TextBlock block : visionText.getTextBlocks()) {
                            for (Text.Line line : block.getLines()) {
                                Rect r = line.getBoundingBox();
                                JSONObject item = new JSONObject();
                                try {
                                    item.put("text", line.getText());
                                    item.put("x", r == null ? 0 : r.left);
                                    item.put("y", r == null ? 0 : r.top);
                                    item.put("w", r == null ? 0 : r.width());
                                    item.put("h", r == null ? 0 : r.height());
                                    lines.put(item);
                                } catch (Exception ignored) {}
                            }
                        }
                        callback("onScreenshotText", lines.toString());
                        recognizer.close();
                    })
                    .addOnFailureListener(e -> {
                        callback("onScreenshotError", JSONObject.quote("图片识别失败：" + e.getMessage()));
                        recognizer.close();
                    });
            } catch (Exception e) { callback("onScreenshotError", JSONObject.quote("无法打开图片：" + e.getMessage())); }
        } else if (request == PICK_IMPORT) {
            worker.execute(() -> {
                JSONObject fileResult = new JSONObject();
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("无法读取文件");
                    byte[] bytes = readLimited(input, MAX_BACKUP_BYTES);
                    String filename = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment().toLowerCase(Locale.ROOT);
                    boolean xlsx = filename.endsWith(".xlsx") || (bytes.length > 4 && bytes[0] == 'P' && bytes[1] == 'K');
                    fileResult.put("name", filename);
                    if (xlsx) fileResult.put("rows", parseXlsx(bytes));
                    else fileResult.put("text", decodeText(bytes));
                } catch (Exception e) { try { fileResult.put("error", e.getMessage() == null ? "导入失败" : e.getMessage()); } catch (Exception ignored) {} }
                callback("onPickedFile", fileResult.toString());
            });
        }
    }

    private static byte[] readLimited(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = input.read(buffer)) != -1) {
            if (out.size() + n > limit)
                throw new IllegalArgumentException("文件过大（上限 " + (limit / 1024 / 1024) + " MB）");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }

    private static String decodeText(byte[] bytes) throws Exception {
        if (bytes.length >= 2 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 254)
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE);
        if (bytes.length >= 2 && (bytes[0] & 255) == 254 && (bytes[1] & 255) == 255)
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE);
        return new String(bytes, StandardCharsets.UTF_8).replaceFirst("^\\uFEFF", "");
    }

    private static JSONArray parseXlsx(byte[] bytes) throws Exception {
        byte[] shared = null, sheet = null;
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.equals("xl/sharedStrings.xml")) shared = readLimited(zip, MAX_IMPORT_BYTES);
                if (sheet == null && name.matches("xl/worksheets/sheet[0-9]+\\.xml")) sheet = readLimited(zip, MAX_IMPORT_BYTES);
                zip.closeEntry();
            }
        }
        if (sheet == null) throw new IllegalArgumentException("找不到 Excel 工作表");
        List<String> strings = new ArrayList<>();
        if (shared != null) {
            NodeList si = xml(shared).getElementsByTagName("si");
            for (int i = 0; i < si.getLength(); i++) {
                Element el = (Element) si.item(i);
                NodeList ts = el.getElementsByTagName("t");
                StringBuilder value = new StringBuilder();
                for (int j = 0; j < ts.getLength(); j++) value.append(ts.item(j).getTextContent());
                strings.add(value.toString());
            }
        }
        JSONArray rows = new JSONArray();
        NodeList xmlRows = xml(sheet).getElementsByTagName("row");
        for (int i = 0; i < Math.min(xmlRows.getLength(), 10001); i++) {
            Element row = (Element) xmlRows.item(i);
            NodeList cells = row.getElementsByTagName("c");
            JSONArray values = new JSONArray();
            for (int j = 0; j < cells.getLength(); j++) {
                Element cell = (Element) cells.item(j);
                String ref = cell.getAttribute("r").replaceAll("[0-9]", "");
                int col = 0;
                for (int k = 0; k < ref.length(); k++) col = col * 26 + ref.charAt(k) - 'A' + 1;
                col = Math.max(0, col - 1);
                if (col >= 50) continue;
                while (values.length() <= col) values.put("");
                NodeList v = cell.getElementsByTagName("v");
                String value = v.getLength() == 0 ? "" : v.item(0).getTextContent();
                if ("s".equals(cell.getAttribute("t"))) {
                    try { value = strings.get(Integer.parseInt(value)); } catch (Exception ignored) {}
                } else if ("inlineStr".equals(cell.getAttribute("t"))) {
                    NodeList t = cell.getElementsByTagName("t");
                    if (t.getLength() > 0) value = t.item(0).getTextContent();
                }
                values.put(col, value);
            }
            rows.put(values);
        }
        return rows;
    }

    private static Document xml(byte[] data) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        f.setExpandEntityReferences(false);
        return f.newDocumentBuilder().parse(new java.io.ByteArrayInputStream(data));
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.goBack && window.goBack()", value -> {
            if ("false".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        achievementWorker.shutdownNow();
        covers.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
