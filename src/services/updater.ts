import { App, Notice, PluginManifest, requestUrl } from "obsidian";

const REPO = "firsttimetogithub3020/obsidian-diary-copilot";
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/manifest.json`;
const MAIN_JS_URL = `https://github.com/${REPO}/releases/latest/download/main.js`;
const STYLES_CSS_URL = `https://github.com/${REPO}/releases/latest/download/styles.css`;

/**
 * Compares two semantic version strings (e.g. "0.1.1" vs "0.1.0").
 * Returns true if remote is strictly greater than current.
 */
export function isNewerVersion(remote: string, current: string): boolean {
  if (!remote || !current) return false;
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPat] = parse(remote);
  const [cMaj, cMin, cPat] = parse(current);

  if (rMaj > cMaj) return true;
  if (rMaj < cMaj) return false;
  if (rMin > cMin) return true;
  if (rMin < cMin) return false;
  return rPat > cPat;
}

/**
 * Checks GitHub release for plugin updates and automatically downloads & replaces
 * main.js, styles.css, and manifest.json if a newer version is available.
 */
export async function checkAndApplyPluginUpdate(
  app: App,
  pluginManifest: PluginManifest,
  manual: boolean = false
): Promise<boolean> {
  try {
    const cacheBuster = `?t=${Date.now()}`;
    const manifestResp = await requestUrl({
      url: `${MANIFEST_URL}${cacheBuster}`,
      headers: { "Cache-Control": "no-cache" },
    });

    if (manifestResp.status !== 200 || !manifestResp.json) {
      if (manual) new Notice("無法連線至更新伺服器，請稍後再試。");
      return false;
    }

    const remoteManifest = manifestResp.json;
    const remoteVer = remoteManifest.version;
    const currentVer = pluginManifest.version;

    if (isNewerVersion(remoteVer, currentVer)) {
      new Notice(`🚀 發現 Diary Copilot 新版本 v${remoteVer}，正在自動下載更新...`, 5000);

      const [mainJsResp, stylesCssResp] = await Promise.all([
        requestUrl({ url: `${MAIN_JS_URL}${cacheBuster}` }),
        requestUrl({ url: `${STYLES_CSS_URL}${cacheBuster}` }),
      ]);

      if (mainJsResp.status === 200 && stylesCssResp.status === 200) {
        const pluginDir = `${app.vault.configDir}/plugins/${pluginManifest.id}`;

        // Overwrite files in vault plugins directory
        await app.vault.adapter.write(`${pluginDir}/main.js`, mainJsResp.text);
        await app.vault.adapter.write(`${pluginDir}/styles.css`, stylesCssResp.text);
        await app.vault.adapter.write(`${pluginDir}/manifest.json`, manifestResp.text);

        new Notice(
          `🎉 Diary Copilot 已成功自動更新至 v${remoteVer}！\n請關閉並重新啟動 Obsidian（或重新開啟外掛）以生效。`,
          8000
        );
        return true;
      } else {
        if (manual) new Notice("下載更新檔案失敗，請檢查網路連線。");
        return false;
      }
    } else {
      if (manual) {
        new Notice(`目前已是最新版本 (v${currentVer})`);
      }
      return false;
    }
  } catch (err: any) {
    console.warn("Diary Copilot update check failed:", err);
    if (manual) {
      new Notice(`檢查更新失敗：${err?.message || "網路連線異常"}`);
    }
    return false;
  }
}
