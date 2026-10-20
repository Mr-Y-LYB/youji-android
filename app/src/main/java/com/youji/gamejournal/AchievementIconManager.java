package com.youji.gamejournal;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.net.Uri;
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
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;

final class AchievementIconManager {
    private final MainActivity activity;
    private final BiConsumer<String, String> callback;
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final Set<String> inFlight = Collections.synchronizedSet(new HashSet<>());

    AchievementIconManager(MainActivity activity, BiConsumer<String, String> callback) {
        this.activity = activity;
        this.callback = callback;
    }

    void ensure(String json) {
        if (json == null || json.length() > 1024 * 1024) return;
        try {
            JSONObject game = new JSONObject(json);
            String id = game.optString("id", "");
            if (!validId(id)) return;
            JSONArray items = game.optJSONArray("items");
            if (items == null) return;
            for (int i = 0; i < Math.min(items.length(), 1000); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String key = item.optString("key", "");
                String url = item.optString("iconUrl", "");
                if (!validKey(key) || !trusted(url)) continue;
                File target = file(id, key);
                if (target.isFile()) continue;
                String token = id + "\n" + key;
                if (!inFlight.add(token)) continue;
                workers.execute(() -> {
                    try {
                        byte[] raw = download(url);
                        writeIcon(target, raw);
                        JSONObject event = new JSONObject();
                        event.put("id", id);
                        event.put("key", key);
                        callback.accept("onAchievementIconReady", event.toString());
                    } catch (Exception ignored) {
                        // Missing network images can be retried when the game is opened again.
                    } finally { inFlight.remove(token); }
                });
            }
        } catch (Exception ignored) {}
    }

    WebResourceResponse response(Uri uri) {
        if (!CoverManager.COVER_HOST.equals(uri.getHost())
            || !"/youji-achievements/icon.jpg".equals(uri.getPath())) return null;
        String id = uri.getQueryParameter("game");
        String key = uri.getQueryParameter("key");
        if (!validId(id) || !validKey(key)) return missing();
        File target = file(id, key);
        try {
            if (!target.isFile()) return missing();
            return new WebResourceResponse("image/jpeg", null, 200, "OK",
                Collections.singletonMap("Cache-Control", "no-store"), new FileInputStream(target));
        } catch (Exception e) { return missing(); }
    }

    private File file(String id, String key) {
        File folder = new File(activity.getFilesDir(), "achievement-icons");
        if (!folder.exists()) folder.mkdirs();
        return new File(folder, hash(id + "\n" + key) + ".jpg");
    }

    private static byte[] download(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("User-Agent", "YouJi/1.3.3 Android");
        try {
            if (connection.getResponseCode() != 200 || !trusted(connection.getURL().toString())
                || !String.valueOf(connection.getContentType()).toLowerCase(Locale.ROOT).startsWith("image/"))
                throw new IllegalStateException("Icon unavailable");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 256 * 1024) throw new IllegalStateException("Icon too large");
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        } finally { connection.disconnect(); }
    }

    static byte[] squareJpeg(byte[] raw) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 4096 || bounds.outHeight > 4096)
            throw new IllegalArgumentException("Invalid icon");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 128);
        Bitmap source = BitmapFactory.decodeByteArray(raw, 0, raw.length, options);
        if (source == null) throw new IllegalArgumentException("Invalid icon");
        Bitmap output = Bitmap.createBitmap(80, 80, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(Color.rgb(28, 36, 56));
        int side = Math.min(source.getWidth(), source.getHeight());
        Rect crop = new Rect((source.getWidth() - side) / 2, (source.getHeight() - side) / 2,
            (source.getWidth() + side) / 2, (source.getHeight() + side) / 2);
        canvas.drawBitmap(source, crop, new Rect(0, 0, 80, 80), new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG));
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try {
            if (!output.compress(Bitmap.CompressFormat.JPEG, 85, bytes)) throw new IllegalStateException("Cannot encode icon");
            return bytes.toByteArray();
        } finally { output.recycle(); source.recycle(); }
    }

    private static void writeIcon(File target, byte[] raw) throws Exception {
        byte[] bytes = squareJpeg(raw);
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(bytes);
            output.getFD().sync();
        }
        if (!temp.renameTo(target)) throw new IllegalStateException("Cannot save icon");
    }

    private static boolean trusted(String address) {
        try {
            URL url = new URL(address);
            String host = url.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(url.getProtocol())
                && (host.equals("steamstatic.com") || host.endsWith(".steamstatic.com"));
        } catch (Exception e) { return false; }
    }

    private static boolean validId(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{1,80}");
    }

    private static boolean validKey(String value) {
        return value != null && !value.isEmpty() && value.length() <= 200;
    }

    private static String hash(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 255));
            return result.toString();
        } catch (Exception e) { return ""; }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    void shutdown() { workers.shutdownNow(); }
}
