var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GDriveSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var GITHUB_VERSION_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/manifest.json";
var GITHUB_MAIN_JS_URL = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main/main.js";
var BATCH_SIZE = 5;
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
    this.addCommand({ id: "sync-now", name: "Sync vault now", callback: () => this.fullTwoWaySync() });
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
  // ── Helper: use requestUrl for all HTTP (works on desktop + mobile/iSH) ──────
  async apiGet(url, token) {
    const resp = await (0, import_obsidian.requestUrl)({ url, headers: { Authorization: "Bearer " + token } });
    if (resp.status >= 400)
      throw new Error(`GET ${url} failed: ${resp.status} ${resp.text}`);
    return JSON.parse(resp.text);
  }
  async apiPost(url, token, body) {
    const resp = await (0, import_obsidian.requestUrl)({
      url,
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (resp.status >= 400)
      throw new Error(`POST ${url} failed: ${resp.status} ${resp.text}`);
    return JSON.parse(resp.text);
  }
  async apiDelete(url, token) {
    await (0, import_obsidian.requestUrl)({ url, method: "DELETE", headers: { Authorization: "Bearer " + token } });
  }
  async apiDownload(url, token) {
    const resp = await (0, import_obsidian.requestUrl)({ url, headers: { Authorization: "Bearer " + token } });
    if (resp.status >= 400)
      throw new Error(`Download failed: ${resp.status}`);
    return resp.arrayBuffer;
  }
  async apiUpload(url, method, token, metadata, content) {
    const boundary = "gdrivesync_boundary_" + Date.now();
    const metaStr = JSON.stringify(metadata);
    const enc = new TextEncoder();
    const metaPart = enc.encode(
      `--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${metaStr}\r
`
    );
    const filePart = enc.encode(`--${boundary}\r
Content-Type: application/octet-stream\r
\r
`);
    const closing = enc.encode(`\r
--${boundary}--`);
    const body = new Uint8Array(metaPart.byteLength + filePart.byteLength + content.byteLength + closing.byteLength);
    body.set(metaPart, 0);
    body.set(filePart, metaPart.byteLength);
    body.set(new Uint8Array(content), metaPart.byteLength + filePart.byteLength);
    body.set(closing, metaPart.byteLength + filePart.byteLength + content.byteLength);
    const resp = await (0, import_obsidian.requestUrl)({
      url,
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: body.buffer
    });
    if (resp.status >= 400)
      throw new Error(`Upload failed: ${resp.status} ${resp.text}`);
    return JSON.parse(resp.text);
  }
  // ── Auto-Updater ───────────────────────────────────────────────────────
  async checkForUpdate() {
    try {
      const resp = await (0, import_obsidian.requestUrl)({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
      const remote = JSON.parse(resp.text);
      if (remote.version !== this.manifest.version) {
        new import_obsidian.Notice(`\u{1F504} GDrive Sync: Update found (${this.manifest.version} \u2192 ${remote.version}). Installing...`);
        await this.selfUpdate(remote.version);
      }
    } catch (e) {
      console.log("GDrive Sync: update check failed", e);
    }
  }
  async selfUpdate(newVersion) {
    try {
      let written = false;
      try {
        const basePath = this.app.vault.adapter.basePath;
        const pluginDir = path.join(basePath, ".obsidian", "plugins", this.manifest.id);
        const jsResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_MAIN_JS_URL + "?t=" + Date.now() });
        fs.writeFileSync(path.join(pluginDir, "main.js"), jsResp.text, "utf8");
        const mResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
        fs.writeFileSync(path.join(pluginDir, "manifest.json"), mResp.text, "utf8");
        written = true;
      } catch (e) {
      }
      if (!written) {
        const pluginPath = `.obsidian/plugins/${this.manifest.id}`;
        const jsResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_MAIN_JS_URL + "?t=" + Date.now() });
        await this.app.vault.adapter.write(`${pluginPath}/main.js`, jsResp.text);
        const mResp = await (0, import_obsidian.requestUrl)({ url: GITHUB_VERSION_URL + "?t=" + Date.now() });
        await this.app.vault.adapter.write(`${pluginPath}/manifest.json`, mResp.text);
      }
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
  errMsg(e) {
    return (e instanceof Error ? e.message : String(e)) || "Unknown error";
  }
  async saveLastSynced() {
    var _a;
    const current = (_a = await this.loadData()) != null ? _a : {};
    await this.saveData({ ...current, lastSynced: this.lastSynced });
  }
  // ── OAuth (uses requestUrl — works on all platforms) ──────────────────────
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 6e4)
      return this.accessToken;
    const resp = await (0, import_obsidian.requestUrl)({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        refresh_token: this.settings.refreshToken,
        grant_type: "refresh_token"
      }).toString()
    });
    if (resp.status >= 400)
      throw new Error("Failed to refresh token: " + resp.text);
    const data = JSON.parse(resp.text);
    if (!data.access_token)
      throw new Error("No access_token in response: " + resp.text);
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + data.expires_in * 1e3;
    return this.accessToken;
  }
  // ── Drive Folder ──────────────────────────────────────────────────────────
  async ensureDriveFolder() {
    var _a;
    if (this.driveFolderId)
      return this.driveFolderId;
    const token = await this.getAccessToken();
    const name = this.settings.driveFolderName;
    const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchData = await this.apiGet(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
      token
    );
    if (((_a = searchData.files) == null ? void 0 : _a.length) > 0) {
      this.driveFolderId = searchData.files[0].id;
      return this.driveFolderId;
    }
    const folder = await this.apiPost("https://www.googleapis.com/drive/v3/files", token, {
      name,
      mimeType: "application/vnd.google-apps.folder"
    });
    this.driveFolderId = folder.id;
    return this.driveFolderId;
  }
  // ── List ALL files on Drive (no limit, paginated) ─────────────────────────
  async listDriveFiles() {
    const token = await this.getAccessToken();
    const folderId = await this.ensureDriveFolder();
    let allFiles = [];
    let pageToken = null;
    do {
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime)`;
      if (pageToken)
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const data = await this.apiGet(url, token);
      allFiles = allFiles.concat(data.files || []);
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return allFiles;
  }
  // ── Two-way sync ───────────────────────────────────────────────────────────
  async fullTwoWaySync() {
    if (!this.isConfigured()) {
      new import_obsidian.Notice("\u26A0\uFE0F GDrive Sync: Please enter credentials first.");
      return;
    }
    if (this.isSyncing)
      return;
    this.isSyncing = true;
    this.setStatus("\u{1F504} Syncing...");
    try {
      await this.ensureDriveFolder();
      const driveFiles = await this.listDriveFiles();
      const driveMap = {};
      for (const df of driveFiles) {
        const realPath = df.name.replace(/___/g, "/");
        driveMap[realPath] = { id: df.id, modifiedTime: new Date(df.modifiedTime).getTime() };
      }
      const token = await this.getAccessToken();
      let downloaded = 0;
      const driveEntries = Object.entries(driveMap);
      for (let i = 0; i < driveEntries.length; i += BATCH_SIZE) {
        const batch = driveEntries.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([filePath, driveInfo]) => {
          const localFile = this.app.vault.getAbstractFileByPath(filePath);
          const localMtime = localFile instanceof import_obsidian.TFile ? localFile.stat.mtime : 0;
          if (driveInfo.modifiedTime > localMtime) {
            try {
              const buffer = await this.apiDownload(
                `https://www.googleapis.com/drive/v3/files/${driveInfo.id}?alt=media`,
                token
              );
              const dir = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : null;
              if (dir) {
                try {
                  await this.app.vault.createFolder(dir);
                } catch (e) {
                }
              }
              if (localFile instanceof import_obsidian.TFile)
                await this.app.vault.modifyBinary(localFile, buffer);
              else
                await this.app.vault.createBinary(filePath, buffer);
              downloaded++;
            } catch (e) {
              console.error("Download error:", filePath, this.errMsg(e));
            }
          }
        }));
        this.setStatus(`\u2B07\uFE0F ${downloaded}/${driveEntries.length}...`);
      }
      const localFiles = this.app.vault.getFiles();
      const toUpload = localFiles.filter((f) => {
        const driveInfo = driveMap[f.path];
        return !driveInfo || f.stat.mtime > driveInfo.modifiedTime;
      });
      let uploaded = 0;
      for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
        const batch = toUpload.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((f) => this.uploadFile(f, true)));
        uploaded += batch.length;
        this.setStatus(`\u2B06\uFE0F ${uploaded}/${toUpload.length}...`);
      }
      await this.saveLastSynced();
      this.setStatus(`\u2705 \u2B07${downloaded} \u2B06${uploaded} \u2014 ${new Date().toLocaleTimeString()}`);
      if (downloaded > 0 || uploaded > 0) {
        new import_obsidian.Notice(`\u2705 GDrive Sync: \u2B07 ${downloaded} downloaded, \u2B06 ${uploaded} uploaded`);
      }
    } catch (e) {
      this.setStatus("\u274C Sync failed");
      new import_obsidian.Notice("\u274C GDrive Sync failed: " + this.errMsg(e));
    }
    this.isSyncing = false;
  }
  // ── Upload single file ────────────────────────────────────────────────────
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
      const query = `name='${safeName}' and '${folderId}' in parents and trashed=false`;
      const searchData = await this.apiGet(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
        token
      );
      const existingId = (_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
      const metadata = { name: safeName, ...existingId ? {} : { parents: [folderId] } };
      const uploadUrl = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart` : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      await this.apiUpload(uploadUrl, existingId ? "PATCH" : "POST", token, metadata, content);
      this.lastSynced[file.path] = file.stat.mtime;
    } catch (e) {
      console.error("GDrive upload error:", file.path, this.errMsg(e));
    }
  }
  // ── Delete from Drive ─────────────────────────────────────────────────────
  async deleteFromDrive(filePath) {
    var _a, _b;
    if (!this.isConfigured())
      return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const safeName = filePath.replace(/\//g, "___");
      const query = `name='${safeName}' and '${folderId}' in parents and trashed=false`;
      const searchData = await this.apiGet(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
        token
      );
      if ((_b = (_a = searchData.files) == null ? void 0 : _a[0]) == null ? void 0 : _b.id) {
        await this.apiDelete(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}`, token);
        delete this.lastSynced[filePath];
        await this.saveLastSynced();
      }
    } catch (e) {
      console.error("GDrive delete error:", this.errMsg(e));
    }
  }
  syncAll() {
    return this.fullTwoWaySync();
  }
  async downloadAll() {
    if (!this.isConfigured()) {
      new import_obsidian.Notice("\u26A0\uFE0F Please enter credentials first.");
      return;
    }
    this.setStatus("\u2B07\uFE0F Downloading from Drive...");
    try {
      const token = await this.getAccessToken();
      const driveFiles = await this.listDriveFiles();
      let count = 0;
      for (let i = 0; i < driveFiles.length; i += BATCH_SIZE) {
        const batch = driveFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (df) => {
          const realPath = df.name.replace(/___/g, "/");
          try {
            const buffer = await this.apiDownload(
              `https://www.googleapis.com/drive/v3/files/${df.id}?alt=media`,
              token
            );
            const dir = realPath.includes("/") ? realPath.substring(0, realPath.lastIndexOf("/")) : null;
            if (dir) {
              try {
                await this.app.vault.createFolder(dir);
              } catch (e) {
              }
            }
            const existing = this.app.vault.getAbstractFileByPath(realPath);
            if (existing instanceof import_obsidian.TFile)
              await this.app.vault.modifyBinary(existing, buffer);
            else
              await this.app.vault.createBinary(realPath, buffer);
            count++;
          } catch (e) {
            console.error("Download error:", realPath, this.errMsg(e));
          }
        }));
        this.setStatus(`\u2B07\uFE0F ${count}/${driveFiles.length}...`);
      }
      this.setStatus(`\u2705 Downloaded ${count} files`);
      new import_obsidian.Notice(`\u2705 Downloaded ${count} files from Google Drive!`);
    } catch (e) {
      this.setStatus("\u274C Download failed");
      new import_obsidian.Notice("\u274C Download failed: " + this.errMsg(e));
    }
  }
  startAutoSync() {
    this.stopAutoSync();
    this.fullTwoWaySync();
    this.syncIntervalId = window.setInterval(() => this.fullTwoWaySync(), this.settings.syncIntervalSeconds * 1e3);
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
    new import_obsidian.Setting(containerEl).setName("Sync now").setDesc("Upload local changes and download Drive changes.").addButton((b) => b.setButtonText("\u{1F504} Two-Way Sync").onClick(() => this.plugin.fullTwoWaySync()));
    new import_obsidian.Setting(containerEl).setName("Download from Drive").setDesc("Force download all files from Drive.").addButton((b) => b.setButtonText("\u2B07 Download All").onClick(() => this.plugin.downloadAll()));
    new import_obsidian.Setting(containerEl).setName("Check for update").setDesc("Manually check GitHub for a newer version.").addButton((b) => b.setButtonText("\u{1F504} Check Update").onClick(() => this.plugin.checkForUpdate()));
  }
};
