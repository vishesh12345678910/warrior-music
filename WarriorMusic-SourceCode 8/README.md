# 🎵 Warrior Music - Complete Production Source Code & Universal Android App

Warrior Music is a high-performance, ad-free music web application and Android app with a Spotify-inspired UI, dual-engine audio playback, full playlist management, search, lyrics, and listening sessions.

---

## 🚀 How to Host on ANY Platform

Warrior Music is architected to run anywhere — on Node.js servers, static hosting, cloud platforms, or local computers.

### Option 1: Run Locally or on a Node.js Server (VPS / Render / Railway / Hostinger)
1. Extract `WarriorMusic-SourceCode.zip`.
2. Open terminal in the project folder and run:
   ```bash
   npm install
   npm start
   ```
3. Open `http://localhost:3000` in your browser.
4. On your local Wi-Fi, open `http://YOUR_PC_IP:3000` from your phone.

### Option 2: Host on Vercel (Recommended 1-Click Static/Serverless)
1. Upload this project folder to GitHub or import directly to [Vercel](https://vercel.com).
2. Framework Preset: **Other**.
3. Output Directory: Leave default (or `public`).
4. Click **Deploy**. `vercel.json` and `_redirects` are already configured for automatic Single Page App routing!

### Option 3: Host on Static Platforms (Netlify / GitHub Pages / Cloudflare Pages / Apache / cPanel)
- **Netlify Drop**: Drag and drop the `public` folder onto [Netlify Drop](https://app.netlify.com/drop).
- **GitHub Pages / cPanel / Apache / Nginx**: Upload files from `public/` directly into your web root (`public_html`).
- The frontend features fully self-contained offline catalogs (`home.json`, `bootstrap.json`) and safe client-side fallbacks, ensuring instant loading on 100% static hosts without backend dependencies.

---

## 📱 Android APK (`WarriorMusic.apk`)

The APK is pre-built, v1+v2 signed, and ready to install on Android devices (Android 8.0 through Android 15+).

### How to Install and Connect:
1. Transfer `WarriorMusic.apk` to your Android device and install it.
2. When you open the app:
   - **Auto-Discovery**: If your computer is running `npm start` on the same Wi-Fi, it automatically detects and connects to your local player!
   - **Custom Hosting**: Type your website URL (e.g., `your-site.vercel.app` or `192.168.1.9:3000`) and tap **Connect**.
   - **Default Server**: Tap **Open Default Server** to connect to the cloud player instantly.
3. Once connected, your address is remembered permanently across restarts.
4. To change the address anytime, go to **Settings > Change Computer** in the app.

---

## ✨ Features
- **Dual-Engine Audio**: Supports resilient YouTube iframe embeds with automatic fallback resolution.
- **Pure Warrior Music Branding**: Zero third-party badges, zero unwanted popups, smooth dark-mode interface.
- **Local Storage Persistence**: Liked songs, custom playlists, recent history, and playback position are preserved locally on the device.
- **Responsive Layout**: Adapts seamlessly to desktop browsers, tablets, and mobile screens.
