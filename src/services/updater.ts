import { App, Notice, PluginManifest, normalizePath } from "obsidian";

/**
 * Compares two semantic version strings (e.g. "0.3.40" vs "0.3.39").
 * Returns true if disk is strictly greater than current.
 */
export function isNewerVersion(disk: string, current: string): boolean {
  if (!disk || !current) return false;
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [dMaj, dMin, dPat] = parse(disk);
  const [cMaj, cMin, cPat] = parse(current);

  if (dMaj > cMaj) return true;
  if (dMaj < cMaj) return false;
  if (dMin > cMin) return true;
  if (dMin < cMin) return false;
  return dPat > cPat;
}

/**
 * Detects whether the local/mobile Plugin folder has been updated (via Obsidian Sync or local build),
 * and safely reloads the Obsidian window so the new code takes effect immediately.
 * Does NOT rely on GitHub releases.
 */
export async function checkAndApplyPluginUpdate(
  app: App,
  pluginManifest: PluginManifest,
  manual: boolean = false
): Promise<boolean> {
  try {
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

    // 1. If folder version is newer than in-memory version (Obsidian Sync just brought in a new version):
    if (diskVersion && isNewerVersion(diskVersion, currentMemVer)) {
      new Notice(`🔄 偵測到 Plugin 資料夾已由 Obsidian Sync 同步新版 (v${diskVersion})！正在為您重新載入...`, 3000);
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
      return true;
    }

    // 2. If user manually tapped the button:
    if (manual) {
      new Notice(`✅ 正在重新載入 Plugin 資料夾最新程式碼 (v${diskVersion || currentMemVer})...`, 2500);
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
      return true;
    }

    return false;
  } catch (err: any) {
    console.warn("[Diary Copilot Updater] Local update check failed:", err);
    if (manual) {
      new Notice(`讀取 Plugin 資料夾失敗：${err?.message || "檔案存取異常"}`);
    }
    return false;
  }
}
