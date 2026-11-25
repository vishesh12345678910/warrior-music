# Warrior Music — Ad-Free Full Music Web Player

An exact reverse-engineered, ad-free web player built with vanilla modern JavaScript and Node.js. Styled identically to the original player (`https://music.novaxhostinger.site/`) and powered by YouTube Music data and the YouTube IFrame Player engine for seamless audio streaming, continuous smart auto-play, local PC hard-drive persistence, and complete account/playlist management.

- **Owner**: `__VISHESH__` (`10vishesh23`)
- **Community Discord**: [https://discord.gg/cFWffVsCX](https://discord.gg/cFWffVsCX)

---

## Key Features

1. **Unrestricted Music Playback**:
   - Stream any song, artist, album, soundtrack, or jukebox.
   - Headless audio streaming powered by the official embedded YouTube IFrame API.
   - Play/Pause, Seek slider, Volume slider with mute toggle, Shuffle, Repeat (Off, All, One).
   - High-fidelity synchronized lyrics synced in real-time from LRCLIB.

2. **YouTube Music Data Integration**:
   - Live search querying YouTube Music data with video IDs, titles, artists, duration, and high-res album thumbnails.
   - Curated Home shelves: Hindi hits, Your Arijit Singh soundtrack, Romantic Hindi songs, A little nostalgia.
   - Instant keyboard search triggered by `/`.

3. **Smart Continuous Auto-Play (Radio Mode)**:
   - When a song finishes, if the current queue has ended, the engine automatically fetches related recommendations matching the artist, genre, and type of the song just played.
   - Music never stops playing automatically!

4. **100% Ad-Free Experience**:
   - Zero pop-ups, zero audio ads, zero banners, and zero third-party tracking across the entire website.

5. **Spotify-Style Multiple Playlists & Library**:
   - Create custom playlists with custom names.
   - Add/remove songs to/from any playlist with 1 click.
   - Dedicated "Liked Songs" collection with heart toggle.
   - Interactive Queue drawer and live Lyrics view.

6. **Account Section & YouTube Music Sign-In**:
   - Profile avatar `(W)` in topbar with dropdown popover menu:
     - `Account`
     - `Recently played`
     - `Settings`
     - `Owners & community`
     - `Support`
   - Settings page (`#settings`) with tabs: `General`, `Appearance`, `Lyrics`, `Playback`, `Integrations`, `Keybinds`.
   - Providers card with `Sign in with YouTube Music` option.
   - Avatar automatically updates to `V` (for Vishesh) upon sign in.

7. **Local PC Storage Persistence**:
   - All account info, playlists, saved tracks, playback history, and preferences are automatically written to `data/storage.json` on your local PC hard drive.
   - State persists across page refreshes, browser restarts, and server restarts.

---

## Architecture & Technology Stack

- **Backend**: Node.js + Express
  - Direct YouTube Innertube API integration (zero API keys required, zero fragile scraping packages).
  - Search endpoint: `/api/search?q={query}`
  - Auto-play / Recommendation endpoint: `/api/related?videoId={id}&artist={artist}`
  - Curated home shelves: `/api/home`
  - Synced lyrics: `/api/web-lyrics?title={title}&artist={artist}`
  - Account signin/signout: `/api/google/signin` & `/api/google/signout`
  - Disk persistence sync: `/api/storage/sync` -> `data/storage.json`
- **Frontend**: Semantic HTML5 + Modern CSS3 + Vanilla ES6+ JavaScript
  - Exact 3-panel UI layout.
  - Headless YouTube IFrame API audio engine (`player.js`).
  - Modular controller (`app.js`).
  - WebSocket group listening support (`listening.js`).

---

## Getting Started

### Prerequisites
- Node.js (v18, v20, v22, v24+)

### 1. Installation
Navigate to the project directory:
```bash
cd "C:\Users\Hp\.gemini\antigravity\scratch\novax-music-app"
npm install
```

### 2. Start the Server
```bash
node server.js
```
The server will start on:
```
http://localhost:3000
```

### 3. Open in Browser
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🚀 Netlify Deployment Guide

Warrior Music is 100% pre-configured for seamless hosting on **Netlify**!

### Method 1: Deploy with Netlify CLI / Git (Recommended)
1. Push this folder to a GitHub, GitLab, or Bitbucket repository.
2. In Netlify, click **Add new site** -> **Import an existing project**.
3. Select your repository. Netlify will automatically detect:
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
   - **Configuration file**: `netlify.toml`
4. Click **Deploy Warrior Music**.
5. Your music web player will be live worldwide on your custom `.netlify.app` domain with complete serverless API routing (`/api/*` handled by `netlify/functions/api.js`).

### Method 2: Instant Drag-and-Drop (Netlify Drop)
1. You can drag and drop either the whole project folder or just the `public` folder directly into [app.netlify.com/drop](https://app.netlify.com/drop).
2. The web client includes built-in static fallback resilience (`/bootstrap.json`, `/home.json`, and client-side offline library persistence) so all UI elements, playlists, and playback function smoothly even without serverless compute!

---

## 💻 Windows Desktop & 📱 Android Mobile Apps

- **Windows Setup Installer**:
  - Located at `public/downloads/WarriorMusic-Setup.exe`
  - Installs **Warrior Music** with desktop shortcuts, start menu integration, and local PC tray support.
  - Zero crashes, tested and verified on Windows 10/11.

- **Android Mobile APK**:
  - Located at `public/downloads/WarriorMusic.apk`
  - Fully branded as **Warrior Music** with the official custom gold/cyan logo.
  - Auto-connects to local network servers via UDP discovery on port 3000.

---

## Keyboard Shortcuts
- `Space`: Play / Pause toggle
- `Right Arrow`: Seek forward 5 seconds
- `Left Arrow`: Seek backward 5 seconds
- `/`: Quick focus search bar
- `Esc`: Close popover / overlay / modal
