package com.youji.gamejournal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Reads public Steam Community achievement schemas; no account credentials are used. */
final class AchievementCatalog {
    private AchievementCatalog() {}

    static JSONObject fetch(JSONObject game) throws Exception {
        String platform = game.optString("platform", "");
        if (!"Steam".equalsIgnoreCase(platform)) throw new IllegalArgumentException("该平台暂无公开成就清单，请手动添加");
        int appId = game.optInt("steamId", 0);
        if (appId <= 0) appId = findAppId(game.optString("titleEn", ""), game.optString("title", ""));
        if (appId <= 0) throw new IllegalArgumentException("未找到对应的 Steam 游戏，请编辑名称后重试");
        String html = get("https://steamcommunity.com/stats/" + appId + "/achievements/?l=schinese", "text/html", 2 * 1024 * 1024);
        String marker = "id=\"valve-ssr-data\"";
        int start = html.indexOf(marker);
        if (start < 0) throw new IllegalStateException("Steam 成就页面格式已变化");
        start = html.indexOf('>', start) + 1;
        int end = html.indexOf("</script>", start);
        if (start <= 0 || end < start) throw new IllegalStateException("Steam 成就页面格式已变化");
        JSONObject page = new JSONObject(html.substring(start, end));
        JSONObject context = page.getJSONObject("renderContext");
        JSONObject cache = new JSONObject(context.getString("queryData"));
        JSONArray queries = cache.getJSONArray("queries");
        JSONObject schema = null;
        for (int i = 0; i < queries.length(); i++) {
            JSONObject query = queries.optJSONObject(i);
            if (query == null) continue;
            JSONArray key = query.optJSONArray("queryKey");
            if (key != null && key.length() >= 3 && "achievements".equals(key.optString(0))
                    && key.optInt(1) == appId && "schema".equals(key.optString(2))) {
                schema = query.getJSONObject("state").optJSONObject("data");
                break;
            }
        }
        if (schema == null) throw new IllegalStateException("Steam 未提供成就清单");
        JSONArray groups = schema.optJSONArray("groups");
        JSONArray items = new JSONArray();
        if (groups != null) for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.optJSONObject(i);
            if (group == null || group.optBoolean("archived") || !group.optBoolean("ispublic", true)) continue;
            JSONArray achievements = group.optJSONArray("achievements");
            if (achievements == null) continue;
            for (int j = 0; j < achievements.length(); j++) {
                JSONObject source = achievements.optJSONObject(j);
                if (source == null || source.optBoolean("archived")) continue;
                String key = source.optString("api_name", "");
                if (key.isEmpty()) key = String.valueOf(source.optLong("internal_key", 0));
                String name = source.optString("name", "");
                if (key.isEmpty() || name.isEmpty()) continue;
                JSONObject item = new JSONObject();
                item.put("key", key);
                item.put("name", name);
                item.put("description", source.optString("description", ""));
                items.put(item);
            }
        }
        JSONObject result = new JSONObject();
        result.put("steamId", appId);
        result.put("items", items);
        return result;
    }

    private static int findAppId(String english, String title) {
        for (String query : new String[]{english, title}) {
            if (query == null || query.trim().isEmpty()) continue;
            try {
                String url = "https://store.steampowered.com/api/storesearch/?term="
                    + URLEncoder.encode(query.trim(), "UTF-8") + "&l="
                    + (query.equals(english) ? "english" : "schinese") + "&cc=CN";
                JSONArray items = new JSONObject(get(url, "application/json", 1024 * 1024)).optJSONArray("items");
                if (items == null) continue;
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item != null && normalize(item.optString("name", "")).equals(normalize(query)))
                        return item.optInt("id", 0);
                }
            } catch (Exception ignored) {}
        }
        return 0;
    }

    private static String normalize(String name) {
        return name.toLowerCase(java.util.Locale.ROOT).replaceAll("[\\s\\p{Punct}：·。！，（）]", "");
    }

    private static String get(String address, String accept, int limit) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(9000);
        connection.setReadTimeout(9000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (compatible; YouJi/1.3.2)");
        connection.setRequestProperty("Accept", accept);
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode());
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > limit) throw new IllegalStateException("成就清单过大");
                    output.write(buffer, 0, count);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        } finally { connection.disconnect(); }
    }
}
