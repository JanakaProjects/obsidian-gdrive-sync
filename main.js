var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GDriveSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var GITHUB_VERSION_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/manifest.json";
var GITHUB_MAIN_JS_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/main.js";
var DEFAULT_SETTINGS = {
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  driveFolderName: "ObsidianVaultSync",
  syncIntervalSeconds: 30,
  autoSyncOnStart: true
};
var GDriveSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.accessToken = "";
    this.accessTokenExpiry = 0;
    this.driveFolderId = "";
    this.syncIntervalId = null;
    this.isSyncing = false;
    this.lastSynced = {};
  }
  async onload() {
    var _a;
    await this.loadSettings();
    const saved = await this.loadData();
    this.lastSynced = (_a = saved == null ? void 0 : saved.lastSynced) != null ? _a : {};
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("\u23F8 GDrive Sync idle");
    this.addCommand({ id: "sync-now", name: "Sync vault now", callback: () => this.syncAll() });
    this.addCommand({ id: "stop-sync", name: "Stop auto-sync", callback: () => this.stopAutoSync() });
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian.TFile)
        this.uploadFile(file);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian.TFile)
        this.uploadFile(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian.TFile)
        this.deleteFromDrive(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian.TFile) {
        this.deleteFromDrive(oldPath);
        this.uploadFile(file);
      }
    }));
    await this.checkForUpdate();
    if (this.settings.autoSyncOnStart && this.isConfigured()) {
      setTimeout(() => this.startAutoSync(), 3e3);
    }
  }
  onunload() {
    this.stopAutoSync();
  }
  // ── Auto-Updater ──────────────────────────────────────────────────────────────
  async checkForUpdate() {
    try {
      const resp = await (0, import_obsidian.requestUrl)({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
      const remote = JSON.parse(resp.text);
      const localVersion = this.manifest.version;
      if (remote.version !== localVersion) {
        new import_obsidian.Notice(`\u{1F504} GDrive Sync: Update found (${localVersion} \u2192 ${remote.version}). Installing...`);
        await this.selfUpdate(remote.version);
      }
    } catch (e) {
      console.log("GDrive Sync: update check failed (offline?)", e);
    }
  }
  async selfUpdate(newVersion) {
    try {
      const jsResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_MAIN_JS_URL + "?t=" + Date.now() });
      const newJs = jsResp.text;
      const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
      await this.app.vault.adapter.write(`${pluginDir}/main.js`, newJs);
      const manifestResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
      await this.app.vault.adapter.write(`${pluginDir}/manifest.json`, manifestResp.text);
      new import_obsidian.Notice(`\u2705 GDrive Sync updated to v${newVersion}! Reloading...`);
      const id = this.manifest.id;
      await this.app.plugins.disablePlugin(id);
      await this.app.plugins.enablePlugin(id);
    } catch (e) {
      console.error("GDrive Sync: self-update failed", e);
      new import_obsidian.Notice("\u274C GDrive Sync: Auto-update failed. Please update manually.");
    }
  }
  isConfigured() {
    return !!(this.settings.clientId && this.settings.clientSecret && this.settings.refreshToken);
  }
  setStatus(msg) {
    this.statusBarItem.setText(msg);
  }
  async saveLastSynced() {
    var _a;
    const current = (_a = await this.loadData()) != null ? _a : {};
    await this.saveData({ ...current, lastSynced: this.lastSynced });
  }
  // ── OAuth ──────────────────────────────────────────────────────────────
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 6e4)
      return this.accessToken;
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        refresh_token: this.settings.refreshToken,
        grant_type: "refresh_token"
      })
    });
    if (!resp.ok)
      throw new Error("Failed to refresh access token: " + await resp.text());
    const data = await resp.json();
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + data.expires_in * 1e3;
    return this.accessToken;
  }
  // ── Drive Folder ─────────────────────────────────────────────────────────
  async ensureDriveFolder() {
    var _a;
    if (this.driveFolderId)
      return this.driveFolderId;
    const token = await this.getAccessToken();
    const name = this.settings.driveFolderName;
    const query = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, { headers: { Authorization: "Bearer " + token } })).json();
    if (((_a = searchData.files) == null ? void 0 : _a.length) > 0) {
      this.driveFolderId = searchData.files[0].id;
      return this.driveFolderId;
    }
    const folder = await (await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" })
    })).json();
    this.driveFolderId = folder.id;
    return this.driveFolderId;
  }
  // ── Upload a file (skips if unchanged) ───────────────────────────────────
  async uploadFile(file, force = false) {
    var _a, _b;
    if (!this.isConfigured())
      return;
    if (!force && this.lastSynced[file.path] && this.lastSynced[file.path] >= file.stat.mtime)
      return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const content = await this.app.vault.readBinary(file);
      const safeName = file.path.replace(/\//g, "___");
      const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
      const existingId = (_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
      const metadata = { name: safeName, ...existingId ? {} : { parents: [folderId] } };
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", new Blob([content]));
      const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      await fetch(url, { method: existingId ? "PATCH" : "POST", headers: { Authorization: "Bearer " + token }, body: form });
      this.lastSynced[file.path] = file.stat.mtime;
      await this.saveLastSynced();
      this.setStatus("\u2705 GDrive synced " + new Date().toLocaleTimeString());
    } catch (e) {
      console.error("GDrive upload error:", e);
      this.setStatus("\u274C Sync error \u2014 check credentials");
    }
  }
  // ── Delete from Drive ─────────────────────────────────────────────────────
  async deleteFromDrive(path) {
    var _a, _b;
    if (!this.isConfigured())
      return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const safeName = path.replace(/\//g, "___");
      const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const searchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
      if ((_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}`, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
        delete this.lastSynced[path];
        await this.saveLastSynced();
      }
    } catch (e) {
      console.error("GDrive delete error:", e);
    }
  }
  // ── Full vault sync (only changed files) ─────────────────────────────────
  async syncAll() {
    if (!this.isConfigured()) {
      new import_obsidian.Notice("\u26A0\uFE0F GDrive Sync: Please enter credentials first.");
      return;
    }
    if (this.isSyncing)
      return;
    this.isSyncing = true;
    this.setStatus("\u{1F504} Checking for changes...");
    try {
      await this.ensureDriveFolder();
      const files = this.app.vault.getFiles();
      const changed = files.filter((f) => !this.lastSynced[f.path] || this.lastSynced[f.path] < f.stat.mtime);
      if (changed.length === 0) {
        this.setStatus("\u2705 Already up to date \u2014 " + new Date().toLocaleTimeString());
        this.isSyncing = false;
        return;
      }
      new import_obsidian.Notice(`GDrive Sync: Uploading ${changed.length} changed file(s)...`);
      let count = 0;
      for (const file of changed) {
        await this.uploadFile(file, true);
        count++;
        this.setStatus(`\u{1F504} Syncing ${count}/${changed.length}...`);
      }
      this.setStatus(`\u2705 Synced ${count} file(s) \u2014 ${new Date().toLocaleTimeString()}`);
      new import_obsidian.Notice(`\u2705 GDrive Sync: ${count} file(s) uploaded!`);
    } catch (e) {
      this.setStatus("\u274C Sync failed");
      new import_obsidian.Notice("\u274C GDrive Sync failed: " + e.message);
    }
    this.isSyncing = false;
  }
  // ── Download from Drive ──────────────────────────────────────────────────
  async downloadAll() {
    if (!this.isConfigured()) {
      new import_obsidian.Notice("\u26A0\uFE0F Please enter credentials first.");
      return;
    }
    this.setStatus("\u2B07\uFE0F Downloading from Drive...");
    new import_obsidian.Notice("GDrive Sync: Downloading vault from Drive...");
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
        if (dir) {
          try {
            await this.app.vault.createFolder(dir);
          } catch (e) {
          }
        }
        try {
          const existing = this.app.vault.getAbstractFileByPath(realPath);
          if (existing instanceof import_obsidian.TFile)
            await this.app.vault.modifyBinary(existing, buffer);
          else
            await this.app.vault.createBinary(realPath, buffer);
          count++;
        } catch (e) {
        }
      }
      this.setStatus(`\u2705 Downloaded ${count} files`);
      new import_obsidian.Notice(`\u2705 Downloaded ${count} files from Google Drive!`);
    } catch (e) {
      this.setStatus("\u274C Download failed");
      new import_obsidian.Notice("\u274C Download failed: " + e.message);
    }
  }
  startAutoSync() {
    this.stopAutoSync();
    this.syncAll();
    this.syncIntervalId = window.setInterval(() => this.syncAll(), this.settings.syncIntervalSeconds * 1e3);
    this.setStatus("\u{1F504} Auto-sync active");
    new import_obsidian.Notice("\u2705 GDrive Auto-Sync started!");
  }
  stopAutoSync() {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      this.setStatus("\u23F8 GDrive Sync paused");
      new import_obsidian.Notice("GDrive Auto-Sync stopped.");
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var GDriveSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Google Drive Vault Sync" });
    containerEl.createEl("p", { text: "Enter your Google OAuth credentials. See README for setup instructions.", cls: "setting-item-description" });
    new import_obsidian.Setting(containerEl).setName("Client ID").setDesc("Google Cloud Console \u2192 Credentials \u2192 OAuth 2.0 Client ID").addText((t) => t.setPlaceholder("xxxx.apps.googleusercontent.com").setValue(this.plugin.settings.clientId).onChange(async (v) => {
      this.plugin.settings.clientId = v.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Client Secret").setDesc("Google Cloud Console \u2192 Credentials").addText((t) => t.setPlaceholder("GOCSPX-...").setValue(this.plugin.settings.clientSecret).onChange(async (v) => {
      this.plugin.settings.clientSecret = v.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Refresh Token").setDesc("From OAuth Playground.").addText((t) => t.setPlaceholder("1//0g...").setValue(this.plugin.settings.refreshToken).onChange(async (v) => {
      this.plugin.settings.refreshToken = v.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Drive Folder Name").addText((t) => t.setValue(this.plugin.settings.driveFolderName).onChange(async (v) => {
      this.plugin.settings.driveFolderName = v.trim() || "ObsidianVaultSync";
      this.plugin.driveFolderId = "";
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auto-sync interval (seconds)").addSlider((s) => s.setLimits(10, 300, 10).setValue(this.plugin.settings.syncIntervalSeconds).setDynamicTooltip().onChange(async (v) => {
      this.plugin.settings.syncIntervalSeconds = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auto-sync on Obsidian open").addToggle((t) => t.setValue(this.plugin.settings.autoSyncOnStart).onChange(async (v) => {
      this.plugin.settings.autoSyncOnStart = v;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "Actions" });
    new import_obsidian.Setting(containerEl).setName("Start auto-sync").addButton((b) => b.setButtonText("\u25B6 Start").setCta().onClick(() => this.plugin.startAutoSync()));
    new import_obsidian.Setting(containerEl).setName("Stop auto-sync").addButton((b) => b.setButtonText("\u23F8 Stop").onClick(() => this.plugin.stopAutoSync()));
    new import_obsidian.Setting(containerEl).setName("Sync now").addButton((b) => b.setButtonText("\u{1F504} Upload Changes").onClick(() => this.plugin.syncAll()));
    new import_obsidian.Setting(containerEl).setName("Download from Drive").addButton((b) => b.setButtonText("\u2B07 Download All").onClick(() => this.plugin.downloadAll()));
    new import_obsidian.Setting(containerEl).setName("Check for update").setDesc("Manually check GitHub for a newer version.").addButton((b) => b.setButtonText("\u{1F504} Check Update").onClick(() => this.plugin.checkForUpdate()));
  }
};
