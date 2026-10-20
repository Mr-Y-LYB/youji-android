package com.youji.gamejournal;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.function.BiConsumer;

final class UpdateManager {
    private static final String REPO = "Mr-Y-LYB/youji-android";
    private static final String API = "https://api.github.com/repos/" + REPO + "/releases/latest";
    private static final String ASSET_PREFIX = "https://github.com/" + REPO + "/releases/download/";
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private final MainActivity activity;
    private final ExecutorService worker;
    private final BiConsumer<String, String> callback;
    private boolean checking;
    private boolean downloading;
    private File pendingInstall;

    UpdateManager(MainActivity activity, ExecutorService worker, BiConsumer<String, String> callback) {
        this.activity = activity;
        this.worker = worker;
        this.callback = callback;
    }

    synchronized void check(boolean manual) {
        if (checking) return;
        checking = true;
        worker.execute(() -> {
            JSONObject response = new JSONObject();
            try {
                JSONObject release = new JSONObject(readJson(API));
                String version = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                if (!version.matches("\\d+\\.\\d+\\.\\d+") || compareVersion(version, currentVersion()) <= 0) {
                    response.put("available", false);
                } else {
                    JSONArray assets = release.optJSONArray("assets");
                    JSONObject apk = null;
                    if (assets != null) for (int i = 0; i < assets.length(); i++) {
                        JSONObject candidate = assets.optJSONObject(i);
                        if (candidate == null) continue;
                        String name = candidate.optString("name", "").toLowerCase(Locale.ROOT);
                        if (name.endsWith(".apk") && name.contains(version.toLowerCase(Locale.ROOT))) {
                            apk = candidate;
                            break;
                        }
                    }
                    if (apk == null) throw new IllegalStateException("该版本尚无 APK 安装包");
                    String url = apk.optString("browser_download_url", "");
                    String digest = apk.optString("digest", "");
                    if (!url.startsWith(ASSET_PREFIX) || !digest.matches("sha256:[a-fA-F0-9]{64}"))
                        throw new IllegalStateException("安装包地址或校验值无效");
                    response.put("available", true);
                    response.put("version", version);
                    response.put("notes", release.optString("body", "").substring(0,
                        Math.min(800, release.optString("body", "").length())));
                    response.put("url", url);
                    response.put("digest", digest);
                    response.put("size", apk.optLong("size", 0));
                }
            } catch (Exception e) {
                response = new JSONObject();
                try { response.put("error", e.getMessage() == null ? "检查更新失败" : e.getMessage()); }
                catch (Exception ignored) {}
            } finally {
                synchronized (this) { checking = false; }
            }
            try { response.put("manual", manual); } catch (Exception ignored) {}
            callback.accept("onUpdateCheck", response.toString());
        });
    }

    synchronized void download(String url, String digest, String version) {
        if (downloading) return;
        if (url == null || !url.startsWith(ASSET_PREFIX)
            || digest == null || !digest.matches("sha256:[a-fA-F0-9]{64}")
            || version == null || !version.matches("\\d+\\.\\d+\\.\\d+")
            || compareVersion(version, currentVersion()) <= 0) {
            result(false, "更新信息无效");
            return;
        }
        downloading = true;
        worker.execute(() -> {
            File temp = null;
            try {
                File dir = new File(activity.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法保存安装包");
                temp = new File(dir, "youji-download.apk");
                File apk = new File(dir, "youji-update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "YouJi/" + currentVersion());
                try {
                    if (conn.getResponseCode() != 200 || !"https".equals(conn.getURL().getProtocol()))
                        throw new IllegalStateException("下载失败");
                    long expectedSize = conn.getContentLengthLong();
                    if (expectedSize > MAX_APK_BYTES) throw new IllegalStateException("安装包过大");
                    MessageDigest hash = MessageDigest.getInstance("SHA-256");
                    long total = 0;
                    int lastPercent = -1;
                    try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            total += read;
                            if (total > MAX_APK_BYTES) throw new IllegalStateException("安装包过大");
                            hash.update(buffer, 0, read);
                            out.write(buffer, 0, read);
                            if (expectedSize > 0) {
                                int percent = (int) (total * 100 / expectedSize);
                                if (percent >= lastPercent + 5) {
                                    lastPercent = percent;
                                    callback.accept("onUpdateProgress", "{\"percent\":" + percent + "}");
                                }
                            }
                        }
                        out.getFD().sync();
                    }
                    if (total == 0 || (expectedSize > 0 && total != expectedSize))
                        throw new IllegalStateException("下载不完整");
                    String actual = hex(hash.digest());
                    if (!actual.equalsIgnoreCase(digest.substring(7)))
                        throw new IllegalStateException("安装包校验失败");
                    verifyPackage(temp, version);
                    if (apk.exists() && !apk.delete()) throw new IllegalStateException("无法替换旧安装包");
                    if (!temp.renameTo(apk)) throw new IllegalStateException("无法保存安装包");
                    File ready = apk;
                    activity.runOnUiThread(() -> install(ready));
                } finally { conn.disconnect(); }
            } catch (Exception e) {
                if (temp != null) temp.delete();
                result(false, e.getMessage() == null ? "更新失败" : e.getMessage());
            } finally {
                synchronized (this) { downloading = false; }
            }
        });
    }

    private void verifyPackage(File apk, String version) throws Exception {
        PackageManager pm = activity.getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)
            || !version.equals(candidate.versionName) || candidate.versionCode <= installed.versionCode
            || candidate.signatures == null || installed.signatures == null
            || candidate.signatures.length != installed.signatures.length)
            throw new IllegalStateException("安装包版本或签名不匹配");
        for (int i = 0; i < candidate.signatures.length; i++)
            if (!candidate.signatures[i].equals(installed.signatures[i]))
                throw new IllegalStateException("安装包签名不匹配");
    }

    private void install(File apk) {
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                pendingInstall = apk;
                result(false, "请允许游迹安装应用，返回后继续");
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(settings);
                return;
            }
            pendingInstall = null;
            Uri uri = FileProvider.getUriForFile(activity,
                activity.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("游迹更新", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            result(true, "请在系统安装界面确认更新");
        } catch (Exception e) {
            result(false, "无法打开系统安装界面");
        }
    }

    void resumePendingInstall() {
        if (pendingInstall != null && activity.getPackageManager().canRequestPackageInstalls())
            install(pendingInstall);
    }

    private void result(boolean ok, String message) {
        JSONObject obj = new JSONObject();
        try { obj.put("ok", ok); obj.put("message", message); } catch (Exception ignored) {}
        callback.accept("onUpdateDownload", obj.toString());
    }

    private String readJson(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(7000);
        conn.setReadTimeout(7000);
        conn.setRequestProperty("User-Agent", "YouJi/" + currentVersion());
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        try {
            if (conn.getResponseCode() != 200) throw new IllegalStateException("更新源暂不可用");
            try (InputStream in = conn.getInputStream()) {
                byte[] bytes = new byte[1024 * 1024];
                int used = 0, count;
                while ((count = in.read(bytes, used, bytes.length - used)) != -1) {
                    used += count;
                    if (used == bytes.length) throw new IllegalStateException("更新信息过大");
                }
                return new String(bytes, 0, used, java.nio.charset.StandardCharsets.UTF_8);
            }
        } finally { conn.disconnect(); }
    }

    static int compareVersion(String a, String b) {
        String[] left = a.split("\\."), right = b.split("\\.");
        for (int i = 0; i < 3; i++) {
            int x = Integer.parseInt(left[i]), y = Integer.parseInt(right[i]);
            if (x != y) return Integer.compare(x, y);
        }
        return 0;
    }

    private String currentVersion() {
        try {
            return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return result.toString();
    }
}
