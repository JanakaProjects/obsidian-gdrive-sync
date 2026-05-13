import {
  App, Plugin, PluginSettingTab, Setting,
  Notice, TFile, TFolder, normalizePath
} from "obsidian";

// ── Settings ────────────────────────────────────────────────────────────────
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

// ── Plugin ───────────────────────────────────────────────────────────────────
export default class GDriveSyncPlugin extends Plugin {
  settings: GDriveSyncSettings;
  accessToken: string = "";
  accessTokenExpiry: number = 0;
  driveFolderId: string = "";
  syncIntervalId: number | null = null;
  statusBarItem: HTMLElement;
  isSyncing: boolean = false;

  async onload() {
    await this.loadSettings();

    // Status bar
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("⏸ GDrive Sync idle");

    // Commands
    this.addCommand({
      id: "sync-now",
      name: "Sync vault now",
      callback: () => this.syncAll(),
    });
    this.addCommand({
      id: "stop-sync",
      name: "Stop auto-sync",
      callback: () => this.stopAutoSync(),
    });

    // Settings tab
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));

    // Watch file changes → push to Drive immediately
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.uploadFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.uploadFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.deleteFromDrive(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.deleteFromDrive(oldPath);
          this.uploadFile(file as TFile);
        }
      })
    );

    // Auto-sync on start
    if (this.settings.autoSyncOnStart && this.isConfigured()) {
      setTimeout(() => this.startAutoSync(), 3000);
    }
  }

  onunload() {
    this.stopAutoSync();
  }

  isConfigured(): boolean {
    return !!(
      this.settings.clientId &&
      this.settings.clientSecret &&
      this.settings.refreshToken
    );
  }

  setStatus(msg: string) {
    this.statusBarItem.setText(msg);
  }

  // ── OAuth ────────────────────────────────────────────────────────────────
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry - 60000) {
      return this.accessToken;
    }
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
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error("Failed to refresh access token: " + err);
    }
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

    const query = encodeURIComponent(
      `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const searchResp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      this.driveFolderId = searchData.files[0].id;
      return this.driveFolderId;
    }

    const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    const folder = await createResp.json();
    this.driveFolderId = folder.id;
    return this.driveFolderId;
  }

  // ── Upload a file ────────────────────────────────────────────────────────
  async uploadFile(file: TFile) {
    if (!this.isConfigured()) return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const content = await this.app.vault.readBinary(file);
      const safeName = file.path.replace(/\//g, "___");
      const query = encodeURIComponent(
        `name='${safeName}' and '${folderId}' in parents and trashed=false`
      );
      const searchResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
        { headers: { Authorization: "Bearer " + token } }
      );
      const searchData = await searchResp.json();
      const existingId = searchData.files?.[0]?.id;

      const metadata = {
        name: safeName,
        ...(existingId ? {} : { parents: [folderId] }),
      };

      const form = new FormData();
      form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
      );
      form.append("file", new Blob([content]));

      const url = existingId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

      await fetch(url, {
        method: existingId ? "PATCH" : "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });

      this.setStatus("✅ GDrive synced " + new Date().toLocaleTimeString());
    } catch (e) {
      console.error("GDrive upload error:", e);
      this.setStatus("❌ Sync error — check credentials");
    }
  }

  // ── Delete a file from Drive ─────────────────────────────────────────────
  async deleteFromDrive(path: string) {
    if (!this.isConfigured()) return;
    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();
      const safeName = path.replace(/\//g, "___");
      const query = encodeURIComponent(
        `name='${safeName}' and '${folderId}' in parents and trashed=false`
      );
      const searchResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
        { headers: { Authorization: "Bearer " + token } }
      );
      const searchData = await searchResp.json();
      if (searchData.files?.[0]?.id) {
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}`,
          { method: "DELETE", headers: { Authorization: "Bearer " + token } }
        );
      }
    } catch (e) {
      console.error("GDrive delete error:", e);
    }
  }

  // ── Full vault sync ──────────────────────────────────────────────────────
  async syncAll() {
    if (!this.isConfigured()) {
      new Notice("⚠️ GDrive Sync: Please enter your credentials in settings first.");
      return;
    }
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.setStatus("🔄 Syncing to Google Drive...");
    new Notice("GDrive Sync: Uploading vault...");

    try {
      await this.ensureDriveFolder();
      const files = this.app.vault.getFiles();
      let count = 0;
      for (const file of files) {
        await this.uploadFile(file);
        count++;
        this.setStatus(`🔄 Syncing ${count}/${files.length}...`);
      }
      this.setStatus(`✅ Synced ${count} files — ${new Date().toLocaleTimeString()}`);
      new Notice(`✅ GDrive Sync: ${count} files uploaded!`);
    } catch (e) {
      this.setStatus("❌ Sync failed");
      new Notice("❌ GDrive Sync failed: " + e.message);
    }
    this.isSyncing = false;
  }

  // ── Download vault from Drive ────────────────────────────────────────────
  async downloadAll() {
    if (!this.isConfigured()) {
      new Notice("⚠️ Please enter credentials first.");
      return;
    }
    this.setStatus("⬇️ Downloading from Drive...");
    new Notice("GDrive Sync: Downloading vault from Drive...");

    try {
      const token = await this.getAccessToken();
      const folderId = await this.ensureDriveFolder();

      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed%3Dfalse&fields=files(id,name)&pageSize=1000`,
        { headers: { Authorization: "Bearer " + token } }
      );
      const listData = await listResp.json();
      const driveFiles = listData.files || [];

      let count = 0;
      for (const df of driveFiles) {
        const realPath = df.name.replace(/___/g, "/");
        const contentResp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${df.id}?alt=media`,
          { headers: { Authorization: "Bearer " + token } }
        );
        const buffer = await contentResp.arrayBuffer();
        const dir = realPath.includes("/")
          ? realPath.substring(0, realPath.lastIndexOf("/"))
          : null;
        if (dir) {
          try { await this.app.vault.createFolder(dir); } catch {}
        }
        try {
          const existing = this.app.vault.getAbstractFileByPath(realPath);
          if (existing instanceof TFile) {
            await this.app.vault.modifyBinary(existing, buffer);
          } else {
            await this.app.vault.createBinary(realPath, buffer);
          }
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

  // ── Auto-sync interval ───────────────────────────────────────────────────
  startAutoSync() {
    this.stopAutoSync();
    this.syncAll();
    this.syncIntervalId = window.setInterval(
      () => this.syncAll(),
      this.settings.syncIntervalSeconds * 1000
    );
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ── Settings UI ──────────────────────────────────────────────────────────────
class GDriveSyncSettingTab extends PluginSettingTab {
  plugin: GDriveSyncPlugin;

  constructor(app: App, plugin: GDriveSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Google Drive Vault Sync" });

    containerEl.createEl("p", {
      text: "Enter your Google OAuth credentials below. See the README for how to get them from Google Cloud Console.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("From Google Cloud Console → Credentials → OAuth 2.0 Client ID")
      .addText((t) =>
        t
          .setPlaceholder("xxxx.apps.googleusercontent.com")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (v) => {
            this.plugin.settings.clientId = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("From Google Cloud Console → Credentials")
      .addText((t) =>
        t
          .setPlaceholder("GOCSPX-...")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (v) => {
            this.plugin.settings.clientSecret = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Refresh Token")
      .setDesc("From OAuth Playground. Never expires — set once, works forever.")
      .addText((t) =>
        t
          .setPlaceholder("1//0g...")
          .setValue(this.plugin.settings.refreshToken)
          .onChange(async (v) => {
            this.plugin.settings.refreshToken = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Drive Folder Name")
      .setDesc("Folder created on your Google Drive to store vault files.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.driveFolderName)
          .onChange(async (v) => {
            this.plugin.settings.driveFolderName = v.trim() || "ObsidianVaultSync";
            this.plugin.driveFolderId = "";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval (seconds)")
      .setDesc("How often to push all changes to Drive. Default: 30s.")
      .addSlider((s) =>
        s
          .setLimits(10, 300, 10)
          .setValue(this.plugin.settings.syncIntervalSeconds)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.syncIntervalSeconds = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync on Obsidian open")
      .setDesc("Start syncing automatically when you open Obsidian.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoSyncOnStart)
          .onChange(async (v) => {
            this.plugin.settings.autoSyncOnStart = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Actions" });

    new Setting(containerEl)
      .setName("Start auto-sync")
      .setDesc("Start continuous syncing to Google Drive.")
      .addButton((b) =>
        b.setButtonText("▶ Start").setCta().onClick(() => this.plugin.startAutoSync())
      );

    new Setting(containerEl)
      .setName("Stop auto-sync")
      .setDesc("Pause automatic syncing.")
      .addButton((b) =>
        b.setButtonText("⏸ Stop").onClick(() => this.plugin.stopAutoSync())
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Push entire vault to Google Drive right now.")
      .addButton((b) =>
        b.setButtonText("🔄 Upload All").onClick(() => this.plugin.syncAll())
      );

    new Setting(containerEl)
      .setName("Download from Drive")
      .setDesc("Pull all files from Google Drive into this vault.")
      .addButton((b) =>
        b.setButtonText("⬇ Download All").onClick(() => this.plugin.downloadAll())
      );
  }
}