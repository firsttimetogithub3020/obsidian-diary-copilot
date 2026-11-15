import { App, Notice, PluginManifest, requestUrl, RequestUrlResponse } from "obsidian";

const REPO = "firsttimetogithub3020/obsidian-diary-copilot";

/**
 * Compares two semantic version strings (e.g. "0.1.8" vs "0.1.7").
 * Returns true if remote is strictly greater than current.
 */
export function isNewerVersion(remote: string, current: string): boolean {
  if (!remote || !current) return false;
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPat] = parse(remote);
  const [cMaj, cMin, cPat] = parse(current);

  if (rMaj > cMaj) return true;
  if (rMaj < cMaj) return false;
  if (rMin > cMin) return true;
  if (rMin < cMin) return false;
  return rPat > cPat;
}

/**
 * Robust helper to extract string body from RequestUrlResponse across Android & iOS WebView.
 */
function getResponseText(resp: RequestUrlResponse): string {
  if (typeof resp.text === "string" && resp.text.length > 0) {
    return resp.text;
  }
  if (resp.arrayBuffer) {
    try {
      return new TextDecoder("utf-8").decode(resp.arrayBuffer);
    } catch {}
  }
  return "";
}

/**
 * Robust JSON parser handling object, text, or binary arrayBuffer.
 */
function parseResponseJson(resp: RequestUrlResponse): any {
  if (resp.json && typeof resp.json === "object") {
    return resp.json;
  }
  const text = getResponseText(resp);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  return null;
}

/**
 * Safely fetches a URL with fallback and timeout.
 */
async function fetchSafe(url: string, headers: Record<string, string> = {}): Promise<RequestUrlResponse | null> {
  try {
    const resp = await requestUrl({
      url,
      headers: {
        "Cache-Control": "no-cache",
        ...headers,
      },
    });
    if (resp.status >= 200 && resp.status < 300) {
      return resp;
    }
  } catch (e) {
    console.debug(`[Diary Copilot Updater] fetchSafe failed for ${url}:`, e);
  }
  return null;
}

/**
 * Fetches the latest manifest from multiple fallback endpoints (raw GitHub CDN -> release asset download -> GitHub API).
 */
async function fetchLatestManifest(): Promise<any | null> {
  const cacheBuster = `?t=${Date.now()}`;

  // 1. Direct Raw GitHub CDN (fastest, no 302 redirects, highly reliable on Android & mobile)
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/manifest.json${cacheBuster}`;
  const rawResp = await fetchSafe(rawUrl);
  if (rawResp) {
    const parsed = parseResponseJson(rawResp);
    if (parsed?.version) return parsed;
  }

  // 2. Latest Release Asset Download URL
  const releaseDownloadUrl = `https://github.com/${REPO}/releases/latest/download/manifest.json${cacheBuster}`;
  const relResp = await fetchSafe(releaseDownloadUrl);
  if (relResp) {
    const parsed = parseResponseJson(relResp);
    if (parsed?.version) return parsed;
  }

  // 3. GitHub API
  const apiUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
  const apiResp = await fetchSafe(apiUrl, { "User-Agent": "obsidian-diary-copilot" });
  if (apiResp) {
    const parsed = parseResponseJson(apiResp);
    if (parsed?.tag_name) {
      const ver = parsed.tag_name.replace(/^v/, "");
      return { version: ver };
    }
  }

  return null;
}

/**
 * Downloads a release asset trying the versioned release tag first, then latest release download.
 */
async function downloadAsset(filename: string, version: string): Promise<string | null> {
  const cacheBuster = `?t=${Date.now()}`;
  const urls = [
    `https://github.com/${REPO}/releases/download/v${version}/${filename}${cacheBuster}`,
    `https://github.com/${REPO}/releases/latest/download/${filename}${cacheBuster}`,
  ];

  for (const url of urls) {
    const resp = await fetchSafe(url);
    if (resp) {
      const text = getResponseText(resp);
      // Basic sanity check to ensure we didn't receive an HTML error page
      if (text && !text.trim().startsWith("<!DOCTYPE") && text.length > 20) {
        return text;
      }
    }
  }
  return null;
}

/**
 * Checks GitHub for updates and automatically replaces files in the vault plugin folder.
 */
export async function checkAndApplyPluginUpdate(
  app: App,
  pluginManifest: PluginManifest,
  manual: boolean = false
): Promise<boolean> {
  try {
    if (manual) {
      new Notice("🔍 正在連線檢查 Diary Copilot 最新版本...", 2000);
    }

    const remoteManifest = await fetchLatestManifest();
    if (!remoteManifest || !remoteManifest.version) {
      if (manual) {
        new Notice("⚠️ 無法連線至更新伺服器或解析版本，請稍後再試。");
      }
      return false;
    }

    const remoteVer = remoteManifest.version.trim();
    const currentVer = pluginManifest.version.trim();

    console.log(`[Diary Copilot Updater] Current: v${currentVer}, Remote: v${remoteVer}`);

    if (isNewerVersion(remoteVer, currentVer)) {
      new Notice(`🚀 發現 Diary Copilot 新版本 v${remoteVer}，正在自動下載更新...`, 6000);

      // Download main.js & styles.css
      const [mainJsText, stylesCssText] = await Promise.all([
        downloadAsset("main.js", remoteVer),
        downloadAsset("styles.css", remoteVer),
      ]);

      if (!mainJsText || !stylesCssText) {
        console.error("[Diary Copilot Updater] Failed to download update assets");
        if (manual) new Notice("❌ 下載更新檔案失敗，請檢查網路連線。");
        return false;
      }

      // Determine plugin directory (using pluginManifest.dir if available)
      const pluginDir =
        (pluginManifest as any).dir ||
        `${app.vault.configDir}/plugins/${pluginManifest.id}`;

      // Ensure directory exists
      if (!(await app.vault.adapter.exists(pluginDir))) {
        await app.vault.adapter.mkdir(pluginDir);
      }

      // Write files safely to vault
      await app.vault.adapter.write(`${pluginDir}/main.js`, mainJsText);
      await app.vault.adapter.write(`${pluginDir}/styles.css`, stylesCssText);
      await app.vault.adapter.write(
        `${pluginDir}/manifest.json`,
        JSON.stringify(
          {
            ...pluginManifest,
            version: remoteVer,
          },
          null,
          2
        )
      );

      console.log(`[Diary Copilot Updater] Successfully updated to v${remoteVer}`);

      new Notice(
        `🎉 Diary Copilot 已成功自動更新至 v${remoteVer}！\n請關閉並重新啟動 Obsidian（或在「社群外掛」中重新開關本外掛）以生效。`,
        9000
      );
      return true;
    } else {
      if (manual) {
        new Notice(`✅ 目前已是最新版本 (v${currentVer})`);
      }
      return false;
    }
  } catch (err: any) {
    console.warn("[Diary Copilot Updater] Update check failed:", err);
    if (manual) {
      new Notice(`檢查更新失敗：${err?.message || "網路連線異常"}`);
    }
    return false;
  }
}
