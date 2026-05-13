import {
  App, Plugin, PluginSettingTab, Setting,
  Notice, TFile, requestUrl
} from "obsidian";
import * as fs from "fs";
import * as path from "path";

const GITHUB_VERSION_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/manifest.json";
const GITHUB_MAIN_JS_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/main.js";
const BATCH_SIZE = 10;

interface GDriveSyncSettings {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  driveFolderName: string;
  syncIntervalSeconds: number;
  autoSyncOnStart: boolean;
}

const DEFAULT_SETTINGS: GDriveSyncSettings = {
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  driveFolderName: "ObsidianVaultSync",
  syncIntervalSeconds: 30,
  autoSyncOnStart: true,
};

export default class GDriveSyncPlugin extends Plugin {
  settings: GDriveSyncSettings;
  accessToken: string = "";
  accessTokenExpiry: number = 0;
  driveFolderId: string = "";
  syncIntervalId: number | null = null;
  statusBarItem: HTMLElement;
  isSyncing: boolean = false;
  lastSynced: Record<string, number> = {};

  async onload() {
    await this.loadSettings();
    const saved = await this.loadData();
    this.lastSynced = saved?.lastSynced ?? {};

    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("⏸ GDrive Sync idle");

    this.addCommand({ id: "sync-now", name: "Sync vault now", callback: () => this.syncAll() });
    this.addCommand({ id: "stop-sync", name: "Stop auto-sync", callback: () => this.stopAutoSync() });
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("modify", (file) => { if (file instanceof TFile) this.uploadFile(file); }));
    this.registerEvent(this.app.vault.on("create", (file) => { if (file instanceof TFile) this.uploadFile(file); }));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (file instanceof TFile) this.deleteFromDrive(file.path); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) { this.deleteFromDrive(oldPath); this.uploadFile(file as TFile); }
    }));

    await this.checkForUpdate();

    if (this.settings.autoSyncOnStart && this.isConfigured()) {
      setTimeout(() => this.startAutoSync(), 3000);
    }
  }

  onunload() { this.stopAutoSync(); }

  // ── Auto-Updater (uses Node fs — works on Obsidian desktop) ──────────────────
  async checkForUpdate() {
    try {
      const resp = await requestUrl({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
      const remote = JSON.parse(resp.text);
      if (remote.version !== this.manifest.version) {
        new Notice(`🔄 GDrive Sync: Update found (${this.manifest.version} → ${remote.version}). Installing...`);
        await this.selfUpdate(remote.version);
      }
    } catch (e) {
      console.log("GDrive Sync: update check failed", e);
    }
  }

  async selfUpdate(newVersion: string) {
    try {
      // Get the absolute path to the plugin folder using Node.js path
      // @ts-ignore
      const basePath = (this.app.vault.adapter as any).basePath;
      const pluginDir = path.join(basePath, ".obsidian", "plugins", this.manifest.id);

      // Fetch new main.js from GitHub
      const jsResp = await requestUrl({ url: GITHUB_MAIN_JS_URL + "?t=" + Date.now() });
      fs.writeFileSync(path.join(pluginDir, "main.js"), jsResp.text, "utf8");

      // Fetch new manifest.json from GitHub
      const manifestResp = await requestUrl({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), manifestResp.text, "utf8");

      new Notice(`✅ GDrive Sync updated to v${newVersion}! Reloading...`);

      // Reload plugin
      const id = this.manifest.id;
      // @ts-ignore
      await this.app.plugins.disablePlugin(id);
      // @ts-ignore
      await this.app.plugins.enablePlugin(id);
    } catch (e) {
      console.error("GDrive Sync: self-update failed", e);
      new Notice("❌ GDrive Sync: Auto-update failed. Please update manually.");
    }
  }

  isConfigured(): boolean {
    return !!(this.settings.clientId && this.settings.clientSecret && this.settings.refreshToken);
  }

  setStatus(msg: string) { this.statusBarItem.setText(msg); }

  async saveLastSynced() {
    const current = await this.loadData() ?? {};
    await this.saveData({ ...current, lastSynced: this.lastSynced });
  }

  // ── OAuth ──────────────────────────────────────────────────────────────
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 60000) return this.accessToken;
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        refresh_token: this.settings.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) throw new Error("Failed to refresh token: " + await resp.text());
    const data = await resp.json();
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  // ── Drive Folder ─────────────────────────────────────────────────────────
  async ensureDriveFolder(): Promise<string> {
    if (this.driveFolderId) return this.driveFolderId;
    const token = await this.getAccessToken();
    const name = this.settings.driveFolderName;
    const query = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, { headers: { Authorization: "Bearer " + token } })).json();
    if (searchData.files?.length > 0) { this.driveFolderId = searchData.files[0].id; return this.driveFolderId; }
    const folder = await (await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    })).json();
    this.driveFolderId = folder.id;
    return this.driveFolderId;
  }

  // ── Upload single file ───────────────────────────────────────────────────
  async uploadFile(file: TFile, force = false) {
    if (!this.isConfigured()) return;
    if (!force && this.lastSynced[file.path] && this.lastSynced[file.path] >= file.stat.mtime) return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const content = await this.app.vault.readBinary(file);
      const safeName = file.path.replace(/\//g, "___");
      const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
      const existingId = searchData.files?.[0]?.id;
      const metadata = { name: safeName, ...(existingId ? {} : { parents: [folderId] }) };
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", new Blob([content]));
      const url = existingId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      await fetch(url, { method: existingId ? "PATCH" : "POST", headers: { Authorization: "Bearer " + token }, body: form });
      this.lastSynced[file.path] = file.stat.mtime;
    } catch (e) {
      console.error("GDrive upload error:", file.path, e);
    }
  }

  // ── Delete from Drive ────────────────────────────────────────────────────
  async deleteFromDrive(path: string) {
    if (!this.isConfigured()) return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const safeName = path.replace(/\//g, "___");
      const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
      if (searchData.files?.[0]?.id) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}`, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
        delete this.lastSynced[path];
        await this.saveLastSynced();
      }
    } catch (e) { console.error("GDrive delete error:", e); }
  }

  // ── Full vault sync — parallel batches of 10 ──────────────────────────────
  async syncAll() {
    if (!this.isConfigured()) { new Notice("⚠️ GDrive Sync: Please enter credentials first."); return; }
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.setStatus("🔄 Checking for changes...");
    try {
      await this.ensureDriveFolder();
      const files = this.app.vault.getFiles();
      const changed = files.filter(f => !this.lastSynced[f.path] || this.lastSynced[f.path] < f.stat.mtime);
      if (changed.length === 0) {
        this.setStatus("✅ Already up to date — " + new Date().toLocaleTimeString());
        this.isSyncing = false;
        return;
      }
      new Notice(`GDrive Sync: Uploading ${changed.length} file(s)...`);
      let done = 0;
      for (let i = 0; i < changed.length; i += BATCH_SIZE) {
        const batch = changed.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(f => this.uploadFile(f, true)));
        done += batch.length;
        this.setStatus(`🔄 Syncing ${done}/${changed.length}...`);
      }
      await this.saveLastSynced();
      this.setStatus(`✅ Synced ${done} file(s) — ${new Date().toLocaleTimeString()}`);
      new Notice(`✅ GDrive Sync: ${done} file(s) uploaded!`);
    } catch (e) {
      this.setStatus("❌ Sync failed");
      new Notice("❌ GDrive Sync failed: " + e.message);
    }
    this.isSyncing = false;
  }

  // ── Download from Drive ──────────────────────────────────────────────────
  async downloadAll() {
    if (!this.isConfigured()) { new Notice("⚠️ Please enter credentials first."); return; }
    this.setStatus("⬇️ Downloading from Drive...");
    new Notice("GDrive Sync: Downloading vault from Drive...");
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const listData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed%3Dfalse&fields=files(id,name)&pageSize=1000`, { headers: { Authorization: "Bearer " + token } })).json();
      const driveFiles = listData.files || [];
      let count = 0;
      for (const df of driveFiles) {
        const realPath = df.name.replace(/___/g, "/");
        const buffer = await (await fetch(`https://www.googleapis.com/drive/v3/files/${df.id}?alt=media`, { headers: { Authorization: "Bearer " + token } })).arrayBuffer();
        const dir = realPath.includes("/") ? realPath.substring(0, realPath.lastIndexOf("/")) : null;
        if (dir) { try { await this.app.vault.createFolder(dir); } catch {} }
        try {
          const existing = this.app.vault.getAbstractFileByPath(realPath);
          if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buffer);
          else await this.app.vault.createBinary(realPath, buffer);
          count++;
        } catch {}
      }
      this.setStatus(`✅ Downloaded ${count} files`);
      new Notice(`✅ Downloaded ${count} files from Google Drive!`);
    } catch (e) {
      this.setStatus("❌ Download failed");
      new Notice("❌ Download failed: " + e.message);
    }
  }

  startAutoSync() {
    this.stopAutoSync();
    this.syncAll();
    this.syncIntervalId = window.setInterval(() => this.syncAll(), this.settings.syncIntervalSeconds * 1000);
    this.setStatus("🔄 Auto-sync active");
    new Notice("✅ GDrive Auto-Sync started!");
  }

  stopAutoSync() {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      this.setStatus("⏸ GDrive Sync paused");
      new Notice("GDrive Auto-Sync stopped.");
    }
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
}

// ── Settings UI ───────────────────────────────────────────────────────────────
class GDriveSyncSettingTab extends PluginSettingTab {
  plugin: GDriveSyncPlugin;
  constructor(app: App, plugin: GDriveSyncPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Google Drive Vault Sync" });
    containerEl.createEl("p", { text: "Enter your Google OAuth credentials. See README for setup instructions.", cls: "setting-item-description" });
    new Setting(containerEl).setName("Client ID").setDesc("Google Cloud Console → Credentials → OAuth 2.0 Client ID").addText((t) => t.setPlaceholder("xxxx.apps.googleusercontent.com").setValue(this.plugin.settings.clientId).onChange(async (v) => { this.plugin.settings.clientId = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Client Secret").setDesc("Google Cloud Console → Credentials").addText((t) => t.setPlaceholder("GOCSPX-...").setValue(this.plugin.settings.clientSecret).onChange(async (v) => { this.plugin.settings.clientSecret = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Refresh Token").setDesc("From OAuth Playground.").addText((t) => t.setPlaceholder("1//0g...").setValue(this.plugin.settings.refreshToken).onChange(async (v) => { this.plugin.settings.refreshToken = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Drive Folder Name").addText((t) => t.setValue(this.plugin.settings.driveFolderName).onChange(async (v) => { this.plugin.settings.driveFolderName = v.trim() || "ObsidianVaultSync"; this.plugin.driveFolderId = ""; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Auto-sync interval (seconds)").addSlider((s) => s.setLimits(10, 300, 10).setValue(this.plugin.settings.syncIntervalSeconds).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.syncIntervalSeconds = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Auto-sync on Obsidian open").addToggle((t) => t.setValue(this.plugin.settings.autoSyncOnStart).onChange(async (v) => { this.plugin.settings.autoSyncOnStart = v; await this.plugin.saveSettings(); }));
    containerEl.createEl("h3", { text: "Actions" });
    new Setting(containerEl).setName("Start auto-sync").addButton((b) => b.setButtonText("▶ Start").setCta().onClick(() => this.plugin.startAutoSync()));
    new Setting(containerEl).setName("Stop auto-sync").addButton((b) => b.setButtonText("⏸ Stop").onClick(() => this.plugin.stopAutoSync()));
    new Setting(containerEl).setName("Sync now").addButton((b) => b.setButtonText("🔄 Upload Changes").onClick(() => this.plugin.syncAll()));
    new Setting(containerEl).setName("Download from Drive").addButton((b) => b.setButtonText("⬇ Download All").onClick(() => this.plugin.downloadAll()));
    new Setting(containerEl).setName("Check for update").setDesc("Manually check GitHub for a newer version.").addButton((b) => b.setButtonText("🔄 Check Update").onClick(() => this.plugin.checkForUpdate()));
  }
}
