import { App, Notice, PluginManifest, requestUrl, RequestUrlResponse, normalizePath } from "obsidian";

const REPO = "firsttimetogithub3020/obsidian-diary-copilot";

/**
 * Compares two semantic version strings (e.g. "0.3.66" vs "0.3.65").
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

  // 1. Direct Raw GitHub CDN (fastest, no 302 redirects, highly reliable on Android & iOS mobile)
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
 * Downloads a release asset trying the versioned release tag first, raw github branch, then latest release download.
 */
async function downloadAsset(filename: string, version: string): Promise<string | null> {
  const cacheBuster = `?t=${Date.now()}`;
  const urls = [
    `https://raw.githubusercontent.com/${REPO}/main/${filename}${cacheBuster}`,
    `https://github.com/${REPO}/releases/download/v${version}/${filename}`,
    `https://github.com/${REPO}/releases/latest/download/${filename}`,
    `https://raw.githubusercontent.com/${REPO}/v${version}/${filename}${cacheBuster}`,
  ];

  for (const url of urls) {
    const resp = await fetchSafe(url);
    if (resp) {
      const text = getResponseText(resp);
      if (text && !text.trim().startsWith("<!DOCTYPE") && text.length > 20) {
        return text;
      }
    }
  }
  return null;
}

/**
 * Checks both remote GitHub (for cross-device / public updates) and local folder (for Obsidian Sync),
 * downloads assets if newer version is on GitHub, and safely reloads Obsidian.
 */
export async function checkAndApplyPluginUpdate(
  app: App,
  pluginManifest: PluginManifest,
  manual: boolean = false
): Promise<boolean> {
  try {
    if (manual) {
      new Notice("🔍 正在連線檢查 Diary Copilot 最新版本...", 2500);
    }

    const pluginDir = normalizePath(`${app.vault.configDir}/plugins/${pluginManifest.id}`);
    const manifestPath = `${pluginDir}/manifest.json`;
    let diskVersion: string | null = null;

    if (await app.vault.adapter.exists(manifestPath)) {
      try {
        const diskManifestText = await app.vault.adapter.read(manifestPath);
        const diskManifest = JSON.parse(diskManifestText);
        if (diskManifest?.version) {
          diskVersion = diskManifest.version.trim();
        }
      } catch (e) {
        console.warn("[Diary Copilot Updater] Failed to read disk manifest:", e);
      }
    }

    const currentMemVer = pluginManifest.version.trim();

    // 1. Check remote GitHub (for external accounts on iPhone / Mac / iPad)
    const remoteManifest = await fetchLatestManifest();
    const remoteVer = remoteManifest?.version ? remoteManifest.version.trim() : null;

    if (remoteVer && isNewerVersion(remoteVer, currentMemVer)) {
      if (manual) {
        new Notice(`🚀 發現 Diary Copilot 新版本 v${remoteVer}，正在自 GitHub 自動下載更新...`, 6000);
      }

      // Download main.js & styles.css
      const [mainJsText, stylesCssText] = await Promise.all([
        downloadAsset("main.js", remoteVer),
        downloadAsset("styles.css", remoteVer),
      ]);

      if (mainJsText && stylesCssText) {
        // Ensure plugin directory exists
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

        console.log(`[Diary Copilot Updater] Successfully updated to v${remoteVer} from GitHub`);
        new Notice(`🎉 Diary Copilot 已成功自動更新至 v${remoteVer}！\n正在為您重新載入外掛...`, 4000);
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
        return true;
      }
    }

    // 2. Check local disk version from Obsidian Sync
    if (diskVersion && isNewerVersion(diskVersion, currentMemVer)) {
      new Notice(`🔄 偵測到 Plugin 資料夾已同步新版 (v${diskVersion})！正在為您重新載入...`, 3000);
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
      return true;
    }

    // 3. User manually tapped button and already on latest
    if (manual) {
      new Notice(`✅ 目前已是最新版本 (v${currentMemVer})`);
      return false;
    }

    return false;
  } catch (err: any) {
    console.warn("[Diary Copilot Updater] Update check failed:", err);
    if (manual) {
      new Notice(`檢查更新失敗：${err?.message || "網路連線異常"}`);
    }
    return false;
  }
}
