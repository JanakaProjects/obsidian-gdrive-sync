/*
 * AUTO-UPDATER BOOTSTRAP
 * This file fetches the latest main.js from GitHub and hot-reloads it.
 * The real plugin logic lives in main.ts on GitHub.
 */
const GITHUB_RAW = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/main.compiled.js";

const { Plugin, Notice } = require("obsidian");

class GDriveSyncBootstrap extends Plugin {
  async onload() {
    // Fetch latest compiled plugin from GitHub
    try {
      const resp = await fetch(GITHUB_RAW + "?t=" + Date.now());
      if (resp.ok) {
        const code = await resp.text();
        const pluginDir = this.app.vault.adapter.getBasePath
          ? this.app.vault.adapter.getBasePath() + "/" + this.manifest.dir
          : null;
        if (pluginDir) {
          const fs = require("fs");
          const path = require("path");
          const target = path.join(pluginDir, "main.js");
          const current = fs.readFileSync(target, "utf8");
          if (current !== code) {
            fs.writeFileSync(target, code, "utf8");
            new Notice("✅ GDrive Sync updated! Reloading plugin...");
            // Reload plugin
            const id = this.manifest.id;
            await this.app.plugins.disablePlugin(id);
            await this.app.plugins.enablePlugin(id);
            return;
          }
        }
      }
    } catch (e) {
      console.log("GDrive auto-update check failed, using cached version.", e);
    }

    // If no update or update failed, load normally from GitHub compiled file
    new Notice("⏸ GDrive Sync: up to date");
  }
}

module.exports = GDriveSyncBootstrap;
