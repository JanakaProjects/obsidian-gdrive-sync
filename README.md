# Google Drive Vault Sync — Obsidian Plugin

Automatically syncs your entire Obsidian vault to Google Drive.
Enter your credentials once → it syncs forever on every device.

---

## How to get your credentials (one-time setup, ~10 mins)

### Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **New Project** → name it anything (e.g. "ObsidianSync")
3. Select your new project

### Step 2 — Enable Google Drive API

1. Go to **APIs & Services → Library**
2. Search **"Google Drive API"** → click it → click **Enable**

### Step 3 — Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. If asked, configure the consent screen first:
   - User Type: **External**
   - App name: anything
   - Add your email as test user
4. Application type: **Desktop app**
5. Name it anything → click **Create**
6. Copy your **Client ID** and **Client Secret** — paste into plugin settings

### Step 4 — Get your Refresh Token

1. Go to https://developers.google.com/oauthplayground
2. Click ⚙️ gear icon (top right) → check **"Use your own OAuth credentials"**
3. Paste your Client ID and Client Secret
4. In the left panel, scroll to **Drive API v3** → select `https://www.googleapis.com/auth/drive`
5. Click **Authorize APIs** → sign into your Google account → allow access
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token** → paste into plugin settings

---

## Installation

### Manual install
1. Run `npm install` then `npm run build` in this folder
2. Copy the entire plugin folder to:
   `YourVault/.obsidian/plugins/gdrive-vault-sync/`
3. Open Obsidian → Settings → Community Plugins → enable it

---

## Using the plugin

1. Open Obsidian → **Settings → Google Drive Vault Sync**
2. Paste **Client ID**, **Client Secret**, **Refresh Token**
3. Click **▶ Start** — it begins syncing immediately
4. Status bar at the bottom shows sync status at all times

### On a second device (phone/tablet)
1. Install Obsidian + this plugin
2. Enter the **same credentials**
3. Click **⬇ Download All** to pull your vault from Drive
4. Then click **▶ Start** for ongoing sync

---

## Features
- ✅ Auto-syncs on Obsidian open
- ✅ Watches every file change — uploads instantly
- ✅ Uploads, downloads, deletes, renames
- ✅ Works on Windows, Android, iOS
- ✅ Status bar shows last sync time
- ✅ Configurable sync interval (10–300 seconds)
- ✅ Refresh token never expires — set once, works forever
