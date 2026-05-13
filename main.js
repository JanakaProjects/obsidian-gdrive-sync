var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
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
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var main_exports = {};
__export(main_exports, { default: () => GDriveSyncPlugin });
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  clientId: "", clientSecret: "", refreshToken: "",
  driveFolderName: "ObsidianVaultSync", syncIntervalSeconds: 30, autoSyncOnStart: true
};
var GDriveSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.accessToken = ""; this.accessTokenExpiry = 0; this.driveFolderId = "";
    this.syncIntervalId = null; this.isSyncing = false;
  }
  onload() {
    return __async(this, null, function* () {
      yield this.loadSettings();
      this.statusBarItem = this.addStatusBarItem();
      this.setStatus("\u23F8 GDrive Sync idle");
      this.addCommand({ id: "sync-now", name: "Sync vault now", callback: () => this.syncAll() });
      this.addCommand({ id: "stop-sync", name: "Stop auto-sync", callback: () => this.stopAutoSync() });
      this.addSettingTab(new GDriveSyncSettingTab(this.app, this));
      this.registerEvent(this.app.vault.on("modify", (file) => { if (file instanceof import_obsidian.TFile) this.uploadFile(file); }));
      this.registerEvent(this.app.vault.on("create", (file) => { if (file instanceof import_obsidian.TFile) this.uploadFile(file); }));
      this.registerEvent(this.app.vault.on("delete", (file) => { if (file instanceof import_obsidian.TFile) this.deleteFromDrive(file.path); }));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { if (file instanceof import_obsidian.TFile) { this.deleteFromDrive(oldPath); this.uploadFile(file); } }));
      if (this.settings.autoSyncOnStart && this.isConfigured()) setTimeout(() => this.startAutoSync(), 3e3);
    });
  }
  onunload() { this.stopAutoSync(); }
  isConfigured() { return !!(this.settings.clientId && this.settings.clientSecret && this.settings.refreshToken); }
  setStatus(msg) { this.statusBarItem.setText(msg); }
  getAccessToken() {
    return __async(this, null, function* () {
      if (this.accessToken && Date.now() < this.accessTokenExpiry - 6e4) return this.accessToken;
      const resp = yield fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, refresh_token: this.settings.refreshToken, grant_type: "refresh_token" })
      });
      if (!resp.ok) throw new Error("Failed to refresh access token: " + (yield resp.text()));
      const data = yield resp.json();
      this.accessToken = data.access_token;
      this.accessTokenExpiry = Date.now() + data.expires_in * 1e3;
      return this.accessToken;
    });
  }
  ensureDriveFolder() {
    return __async(this, null, function* () {
      if (this.driveFolderId) return this.driveFolderId;
      const token = yield this.getAccessToken();
      const name = this.settings.driveFolderName;
      const query = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const searchData = yield (yield fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, { headers: { Authorization: "Bearer " + token } })).json();
      if (searchData.files && searchData.files.length > 0) { this.driveFolderId = searchData.files[0].id; return this.driveFolderId; }
      const folder = yield (yield fetch("https://www.googleapis.com/drive/v3/files", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) })).json();
      this.driveFolderId = folder.id;
      return this.driveFolderId;
    });
  }
  uploadFile(file) {
    return __async(this, null, function* () {
      var _a, _b;
      if (!this.isConfigured()) return;
      try {
        const token = yield this.getAccessToken();
        const folderId = yield this.ensureDriveFolder();
        const content = yield this.app.vault.readBinary(file);
        const safeName = file.path.replace(/\//g, "___");
        const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
        const searchData = yield (yield fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
        const existingId = (_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
        const metadata = __spreadValues({ name: safeName }, existingId ? {} : { parents: [folderId] });
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", new Blob([content]));
        const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
        yield fetch(url, { method: existingId ? "PATCH" : "POST", headers: { Authorization: "Bearer " + token }, body: form });
        this.setStatus("\u2705 GDrive synced " + new Date().toLocaleTimeString());
      } catch (e) { console.error("GDrive upload error:", e); this.setStatus("\u274C Sync error \u2014 check credentials"); }
    });
  }
  deleteFromDrive(path) {
    return __async(this, null, function* () {
      var _a, _b;
      if (!this.isConfigured()) return;
      try {
        const token = yield this.getAccessToken();
        const folderId = yield this.ensureDriveFolder();
        const safeName = path.replace(/\//g, "___");
        const query = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
        const searchData = yield (yield fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: "Bearer " + token } })).json();
        if ((_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id) yield fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}`, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      } catch (e) { console.error("GDrive delete error:", e); }
    });
  }
  syncAll() {
    return __async(this, null, function* () {
      if (!this.isConfigured()) { new import_obsidian.Notice("\u26A0\uFE0F GDrive Sync: Please enter your credentials in settings first."); return; }
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.setStatus("\uD83D\uDD04 Syncing to Google Drive...");
      new import_obsidian.Notice("GDrive Sync: Uploading vault...");
      try {
        yield this.ensureDriveFolder();
        const files = this.app.vault.getFiles();
        let count = 0;
        for (const file of files) { yield this.uploadFile(file); count++; this.setStatus(`\uD83D\uDD04 Syncing ${count}/${files.length}...`); }
        this.setStatus(`\u2705 Synced ${count} files \u2014 ${new Date().toLocaleTimeString()}`);
        new import_obsidian.Notice(`\u2705 GDrive Sync: ${count} files uploaded!`);
      } catch (e) { this.setStatus("\u274C Sync failed"); new import_obsidian.Notice("\u274C GDrive Sync failed: " + e.message); }
      this.isSyncing = false;
    });
  }
  downloadAll() {
    return __async(this, null, function* () {
      if (!this.isConfigured()) { new import_obsidian.Notice("\u26A0\uFE0F Please enter credentials first."); return; }
      this.setStatus("\u2B07\uFE0F Downloading from Drive...");
      new import_obsidian.Notice("GDrive Sync: Downloading vault from Drive...");
      try {
        const token = yield this.getAccessToken();
        const folderId = yield this.ensureDriveFolder();
        const listData = yield (yield fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed%3Dfalse&fields=files(id,name)&pageSize=1000`, { headers: { Authorization: "Bearer " + token } })).json();
        const driveFiles = listData.files || [];
        let count = 0;
        for (const df of driveFiles) {
          const realPath = df.name.replace(/___/g, "/");
          const buffer = yield (yield fetch(`https://www.googleapis.com/drive/v3/files/${df.id}?alt=media`, { headers: { Authorization: "Bearer " + token } })).arrayBuffer();
          const dir = realPath.includes("/") ? realPath.substring(0, realPath.lastIndexOf("/")) : null;
          if (dir) { try { yield this.app.vault.createFolder(dir); } catch {} }
          try {
            const existing = this.app.vault.getAbstractFileByPath(realPath);
            if (existing instanceof import_obsidian.TFile) yield this.app.vault.modifyBinary(existing, buffer);
            else yield this.app.vault.createBinary(realPath, buffer);
            count++;
          } catch {}
        }
        this.setStatus(`\u2705 Downloaded ${count} files`);
        new import_obsidian.Notice(`\u2705 Downloaded ${count} files from Google Drive!`);
      } catch (e) { this.setStatus("\u274C Download failed"); new import_obsidian.Notice("\u274C Download failed: " + e.message); }
    });
  }
  startAutoSync() {
    this.stopAutoSync();
    this.syncAll();
    this.syncIntervalId = window.setInterval(() => this.syncAll(), this.settings.syncIntervalSeconds * 1e3);
    this.setStatus("\uD83D\uDD04 Auto-sync active");
    new import_obsidian.Notice("\u2705 GDrive Auto-Sync started!");
  }
  stopAutoSync() {
    if (this.syncIntervalId !== null) { clearInterval(this.syncIntervalId); this.syncIntervalId = null; this.setStatus("\u23F8 GDrive Sync paused"); new import_obsidian.Notice("GDrive Auto-Sync stopped."); }
  }
  loadSettings() { return __async(this, null, function* () { this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData()); }); }
  saveSettings() { return __async(this, null, function* () { yield this.saveData(this.settings); }); }
};
var GDriveSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Google Drive Vault Sync" });
    containerEl.createEl("p", { text: "Enter your Google OAuth credentials below. See the README for how to get them from Google Cloud Console.", cls: "setting-item-description" });
    new import_obsidian.Setting(containerEl).setName("Client ID").setDesc("From Google Cloud Console \u2192 Credentials \u2192 OAuth 2.0 Client ID").addText((t) => t.setPlaceholder("xxxx.apps.googleusercontent.com").setValue(this.plugin.settings.clientId).onChange((v) => __async(this, null, function* () { this.plugin.settings.clientId = v.trim(); yield this.plugin.saveSettings(); })));
    new import_obsidian.Setting(containerEl).setName("Client Secret").setDesc("From Google Cloud Console \u2192 Credentials").addText((t) => t.setPlaceholder("GOCSPX-...").setValue(this.plugin.settings.clientSecret).onChange((v) => __async(this, null, function* () { this.plugin.settings.clientSecret = v.trim(); yield this.plugin.saveSettings(); })));
    new import_obsidian.Setting(containerEl).setName("Refresh Token").setDesc("From OAuth Playground. Never expires \u2014 set once, works forever.").addText((t) => t.setPlaceholder("1//0g...").setValue(this.plugin.settings.refreshToken).onChange((v) => __async(this, null, function* () { this.plugin.settings.refreshToken = v.trim(); yield this.plugin.saveSettings(); })));
    new import_obsidian.Setting(containerEl).setName("Drive Folder Name").setDesc("Folder created on your Google Drive to store vault files.").addText((t) => t.setValue(this.plugin.settings.driveFolderName).onChange((v) => __async(this, null, function* () { this.plugin.settings.driveFolderName = v.trim() || "ObsidianVaultSync"; this.plugin.driveFolderId = ""; yield this.plugin.saveSettings(); })));
    new import_obsidian.Setting(containerEl).setName("Auto-sync interval (seconds)").setDesc("How often to push all changes to Drive. Default: 30s.").addSlider((s) => s.setLimits(10, 300, 10).setValue(this.plugin.settings.syncIntervalSeconds).setDynamicTooltip().onChange((v) => __async(this, null, function* () { this.plugin.settings.syncIntervalSeconds = v; yield this.plugin.saveSettings(); })));
    new import_obsidian.Setting(containerEl).setName("Auto-sync on Obsidian open").setDesc("Start syncing automatically when you open Obsidian.").addToggle((t) => t.setValue(this.plugin.settings.autoSyncOnStart).onChange((v) => __async(this, null, function* () { this.plugin.settings.autoSyncOnStart = v; yield this.plugin.saveSettings(); })));
    containerEl.createEl("h3", { text: "Actions" });
    new import_obsidian.Setting(containerEl).setName("Start auto-sync").setDesc("Start continuous syncing to Google Drive.").addButton((b) => b.setButtonText("\u25B6 Start").setCta().onClick(() => this.plugin.startAutoSync()));
    new import_obsidian.Setting(containerEl).setName("Stop auto-sync").setDesc("Pause automatic syncing.").addButton((b) => b.setButtonText("\u23F8 Stop").onClick(() => this.plugin.stopAutoSync()));
    new import_obsidian.Setting(containerEl).setName("Sync now").setDesc("Push entire vault to Google Drive right now.").addButton((b) => b.setButtonText("\uD83D\uDD04 Upload All").onClick(() => this.plugin.syncAll()));
    new import_obsidian.Setting(containerEl).setName("Download from Drive").setDesc("Pull all files from Google Drive into this vault.").addButton((b) => b.setButtonText("\u2B07 Download All").onClick(() => this.plugin.downloadAll()));
  }
};
