package com.youji.gamejournal;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.net.Uri;
import android.util.Base64;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;

final class CoverManager {
    static final String COVER_HOST = "appassets.androidplatform.net";
    private static final int MAX_IMAGE_BYTES = 12 * 1024 * 1024;
    private static final long NEGATIVE_TTL = 7L * 24 * 60 * 60 * 1000;
    private final MainActivity activity;
    private final BiConsumer<String, String> callback;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final Set<String> inFlight = Collections.synchronizedSet(new HashSet<>());

    CoverManager(MainActivity activity, BiConsumer<String, String> callback) {
        this.activity = activity;
        this.callback = callback;
    }

    void ensure(String json) {
        if (json == null || json.length() > 2 * 1024 * 1024) return;
        try {
            JSONArray items = new JSONArray(json);
            for (int i = 0; i < Math.min(items.length(), 10000); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                String title = item.optString("title", "");
                String titleEn = item.optString("titleEn", "");
                int steamId = item.optInt("steamId", 0);
                boolean force = item.optBoolean("force", false);
                if (!validId(id) || title.isEmpty() || title.length() > 160 || titleEn.length() > 160
                    || manualFile(id).isFile() || autoFile(id).isFile()) continue;
                String missKey = hash(id + "\n" + normalize(title) + "\n" + normalize(titleEn));
                long lastMiss = activity.getPreferences(0).getLong("cover_miss_" + missKey, 0);
                if (!force && System.currentTimeMillis() - lastMiss < NEGATIVE_TTL) continue;
                if (!inFlight.add(id)) continue;
                workers.execute(() -> {
                    try {
                        Cover found = findCover(title, titleEn, steamId);
                        if (found == null) {
                            activity.getPreferences(0).edit().putLong("cover_miss_" + missKey,
                                System.currentTimeMillis()).apply();
                            return;
                        }
                        byte[] image = downloadImage(found.url);
                        writeCover(autoFile(id), image);
                        JSONObject result = new JSONObject();
                        result.put("id", id);
                        result.put("steamId", found.steamId);
                        callback.accept("onCoverReady", result.toString());
                    } catch (Exception ignored) {
                        // Network and image failures may be retried on the next launch.
                    } finally {
                        inFlight.remove(id);
                    }
                });
            }
        } catch (Exception ignored) {}
    }

    private Cover findCover(String title, String titleEn, int requestedId) throws Exception {
        String[] queries = titleEn.isEmpty() || normalize(titleEn).equals(normalize(title))
            ? new String[]{title} : new String[]{titleEn, title};
        for (String query : queries) {
            try {
            JSONObject search = new JSONObject(readText(
                "https://store.steampowered.com/api/storesearch/?term="
                + java.net.URLEncoder.encode(query, "UTF-8") + "&l="
                + (query.equals(titleEn) ? "english" : "schinese") + "&cc=CN", 1024 * 1024));
            JSONArray items = search.optJSONArray("items");
            if (items == null) continue;
            for (int i = 0; i < Math.min(items.length(), 20); i++) {
                JSONObject candidate = items.optJSONObject(i);
                if (candidate == null) continue;
                int id = candidate.optInt("id", 0);
                String name = normalize(candidate.optString("name", ""));
                boolean exact = !name.isEmpty()
                    && (name.equals(normalize(title)) || name.equals(normalize(titleEn)));
                if (id > 0 && (id == requestedId || requestedId <= 0 && exact)) {
                    String image = candidate.optString("tiny_image", "");
                    if (trustedImageUrl(image)) return new Cover(id, image);
                }
            }
            } catch (Exception ignored) {
                // Try the alternate localized name if this search is unavailable.
            }
        }
        if (requestedId > 0) {
            JSONObject root = new JSONObject(readText(
                "https://store.steampowered.com/api/appdetails?appids=" + requestedId
                + "&l=english&cc=US", 1024 * 1024));
            JSONObject app = root.optJSONObject(String.valueOf(requestedId));
            JSONObject detail = app == null ? null : app.optJSONObject("data");
            String image = detail == null ? "" : detail.optString("header_image", "");
            if (trustedImageUrl(image)) return new Cover(requestedId, image);
        }
        return null;
    }

    private static String readText(String url, int limit) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(7000);
        conn.setReadTimeout(7000);
        conn.setRequestProperty("User-Agent", "YouJi/1.3 Android");
        conn.setRequestProperty("Accept", "application/json");
        try {
            if (conn.getResponseCode() != 200) throw new IllegalStateException("HTTP " + conn.getResponseCode());
            return new String(readLimited(conn.getInputStream(), limit), StandardCharsets.UTF_8);
        } finally { conn.disconnect(); }
    }

    private static byte[] downloadImage(String url) throws Exception {
        if (!trustedImageUrl(url)) throw new IllegalArgumentException("Untrusted image URL");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(7000);
        conn.setReadTimeout(10000);
        conn.setRequestProperty("User-Agent", "YouJi/1.3 Android");
        try {
            if (conn.getResponseCode() != 200 || !trustedImageUrl(conn.getURL().toString())
                || !String.valueOf(conn.getContentType()).toLowerCase(Locale.ROOT).startsWith("image/"))
                throw new IllegalStateException("Image unavailable");
            return readLimited(conn.getInputStream(), 2 * 1024 * 1024);
        } finally { conn.disconnect(); }
    }

    private static byte[] readLimited(InputStream input, int limit) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > limit) throw new IllegalArgumentException("Image too large");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }

    private static boolean trustedImageUrl(String url) {
        try {
            URL parsed = new URL(url);
            String host = parsed.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(parsed.getProtocol())
                && (host.equals("steamstatic.com") || host.endsWith(".steamstatic.com"));
        } catch (Exception e) { return false; }
    }

    private static String normalize(String text) {
        StringBuilder result = new StringBuilder();
        String lower = text == null ? "" : text.toLowerCase(Locale.ROOT);
        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            if (Character.isLetterOrDigit(c)) result.append(c);
        }
        return result.toString();
    }

    private static boolean validId(String id) {
        return id != null && id.length() > 0 && id.length() <= 80 && id.matches("[A-Za-z0-9_-]+");
    }

    private static String hash(String text) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 255));
            return result.toString();
        } catch (Exception e) { return ""; }
    }

    private File folder() {
        File folder = new File(activity.getFilesDir(), "covers");
        if (!folder.exists()) folder.mkdirs();
        return folder;
    }

    private File autoFile(String id) { return new File(folder(), "auto-" + hash(id) + ".jpg"); }
    private File manualFile(String id) { return new File(folder(), "manual-" + hash(id) + ".jpg"); }

    WebResourceResponse response(Uri uri) {
        if (!COVER_HOST.equals(uri.getHost()) || uri.getPath() == null
            || !uri.getPath().startsWith("/youji-covers/"))
            return null;
        String segment = uri.getLastPathSegment();
        String id = segment != null && segment.endsWith(".jpg")
            ? segment.substring(0, segment.length() - 4) : "";
        if (!validId(id)) return missing();
        File file = manualFile(id).isFile() ? manualFile(id) : autoFile(id);
        try {
            if (!file.isFile()) return missing();
            return new WebResourceResponse("image/jpeg", null, 200, "OK",
                Collections.singletonMap("Cache-Control", "no-store"), new FileInputStream(file));
        } catch (Exception e) { return missing(); }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    boolean saveManual(String id, String base64) {
        if (!validId(id) || base64 == null || base64.length() > 500000) return false;
        try {
            writeCover(manualFile(id), Base64.decode(base64, Base64.DEFAULT));
            return true;
        } catch (Exception e) { return false; }
    }

    String manualData(String id) {
        if (!validId(id)) return "";
        try (InputStream input = new FileInputStream(manualFile(id))) {
            return Base64.encodeToString(readLimited(input, 250000), Base64.NO_WRAP);
        } catch (Exception e) { return ""; }
    }

    void importManual(String id, Uri uri) {
        workers.execute(() -> {
            try (InputStream input = activity.getContentResolver().openInputStream(uri)) {
                if (!validId(id) || input == null) throw new IllegalArgumentException("无法读取图片");
                writeCover(manualFile(id), readLimited(input, MAX_IMAGE_BYTES));
                JSONObject result = new JSONObject();
                result.put("id", id);
                callback.accept("onManualCoverReady", result.toString());
            } catch (Exception e) {
                callback.accept("onCoverError", JSONObject.quote("封面导入失败，请换一张图片"));
            }
        });
    }

    void clearAuto(String id) { if (validId(id)) autoFile(id).delete(); }
    void clearManual(String id) { if (validId(id)) manualFile(id).delete(); }
    void clearAll(String id) { clearAuto(id); clearManual(id); }
    void shutdown() { workers.shutdownNow(); }

    private static void writeCover(File target, byte[] bytes) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0
            || bounds.outWidth > 20000 || bounds.outHeight > 20000)
            throw new IllegalArgumentException("Invalid image");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth / options.inSampleSize, bounds.outHeight / options.inSampleSize) > 1200)
            options.inSampleSize *= 2;
        Bitmap source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (source == null) throw new IllegalArgumentException("Invalid image");
        Bitmap output = Bitmap.createBitmap(400, 210, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        float ratio = Math.min(source.getWidth() / 400f, source.getHeight() / 210f);
        int sourceW = Math.round(400 * ratio), sourceH = Math.round(210 * ratio);
        Rect crop = new Rect((source.getWidth() - sourceW) / 2, (source.getHeight() - sourceH) / 2,
            (source.getWidth() + sourceW) / 2, (source.getHeight() + sourceH) / 2);
        canvas.drawBitmap(source, crop, new Rect(0, 0, 400, 210),
            new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG));
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            if (!output.compress(Bitmap.CompressFormat.JPEG, 80, out))
                throw new IllegalStateException("Cannot encode image");
            out.getFD().sync();
        } finally {
            output.recycle();
            source.recycle();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("Cannot replace image");
        if (!temp.renameTo(target)) throw new IllegalStateException("Cannot save image");
    }

    private static final class Cover {
        final int steamId;
        final String url;
        Cover(int steamId, String url) { this.steamId = steamId; this.url = url; }
    }
}
