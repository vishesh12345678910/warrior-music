import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import dgram from 'dgram';
import os from 'os';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

let __filename = '';
let __dirname = '';
try {
  if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
  } else {
    __dirname = process.cwd();
  }
} catch {
  __dirname = process.cwd();
}

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware to support serverless environments (Netlify/AWS Lambda) whether /api prefix is stripped or retained
app.use((req, res, next) => {
  if (!req.url.startsWith('/api') && !req.url.startsWith('/downloads') && !req.url.startsWith('/assets')) {
    const apiRoutes = ['bootstrap', 'home', 'search', 'related', 'web-lyrics', 'provider-status', 'action', 'google', 'storage', 'events'];
    const firstSegment = req.url.split('/')[1]?.split('?')[0];
    if (apiRoutes.includes(firstSegment)) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

// Dedicated Download Endpoints for Warrior Music Installers (MUST BE BEFORE express.static)
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');

// Redirect legacy NovaX installer URLs to Warrior Music
app.get('/downloads/NovaXCloudMusic-SetupV3.exe', (req, res) => {
  res.redirect(302, '/downloads/WarriorMusic-Setup.exe');
});

app.get('/downloads/NovaXCloudMusic.apk', (req, res) => {
  res.redirect(302, '/downloads/WarriorMusic.apk');
});

// Dedicated Download Endpoint for Warrior Music Setup
app.get('/downloads/WarriorMusic-Setup.exe', (req, res) => {
  const filePath = path.join(DOWNLOADS_DIR, 'WarriorMusic-Setup.exe');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'WarriorMusic-Setup.exe');
  } else {
    res.status(404).send('Warrior Music installer not found');
  }
});

// Dedicated Download Endpoint for Warrior Music APK
app.get('/downloads/WarriorMusic.apk', (req, res) => {
  const filePath = path.join(DOWNLOADS_DIR, 'WarriorMusic.apk');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'WarriorMusic.apk');
  } else {
    res.status(404).send('Warrior Music APK not found');
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => {
    if (p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const isServerless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isServerless ? path.join(os.tmpdir(), 'warrior-music-data') : path.join(__dirname, 'data');
const BOOTSTRAP_FILE = path.join(__dirname, 'data', 'bootstrap.json');
const STORAGE_FILE = path.join(DATA_DIR, 'storage.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch {}

// Ensure storage file exists
function readStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    }
    // Fallback to bundled data/storage.json if in serverless
    const bundledStorage = path.join(__dirname, 'data', 'storage.json');
    if (fs.existsSync(bundledStorage)) {
      return JSON.parse(fs.readFileSync(bundledStorage, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading storage.json:', e);
  }
  return {
    account: { name: 'Vishesh', email: 'vishesh@gmail.com', avatar: 'V', signedIn: false },
    collections: [],
    saved: [],
    recents: [],
    preferences: { theme: 'system', motion: false, centered: true, remaining: false, lyrics: true }
  };
}

function writeStorage(data) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing storage.json:', e);
  }
}

// Convert "3:45" or "1:02:10" duration string to seconds
function parseDurationSecs(str) {
  if (!str) return 210;
  if (typeof str === 'number') return str;
  const parts = String(str).split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(str) || 210;
}

// Native YouTube Innertube Search (Zero API keys required)
async function searchYouTube(query) {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20240101.01.00' }
        },
        query: String(query || '').trim()
      })
    });

    if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
    const data = await res.json();
    const items = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const songs = [];
    for (const item of items) {
      const vr = item.videoRenderer;
      if (!vr || !vr.videoId) continue;

      const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'Unknown Title';
      const artists = vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || 'Various Artists';
      const durationSecs = parseDurationSecs(vr.lengthText?.simpleText);
      const cover = vr.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;

      songs.push({
        id: vr.videoId,
        title,
        artists,
        album: '',
        duration: durationSecs,
        kind: 'song',
        link: `https://music.youtube.com/watch?v=${vr.videoId}`,
        cover
      });
    }
    return songs;
  } catch (err) {
    console.error('searchYouTube error:', err);
    return [];
  }
}

// Native YouTube Innertube Related Songs Recommendation
async function getRelatedSongs(videoId, artistHint = '') {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20240101.01.00' }
        },
        videoId
      })
    });

    if (!res.ok) throw new Error(`Next API ${res.status}`);
    const data = await res.json();
    const results = [];

    const sec = data.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
    for (const item of sec) {
      if (item.compactVideoRenderer) {
        const vr = item.compactVideoRenderer;
        results.push({
          id: vr.videoId,
          title: vr.title?.simpleText || vr.title?.runs?.[0]?.text || '',
          artists: vr.shortBylineText?.runs?.[0]?.text || 'Various Artists',
          album: '',
          duration: parseDurationSecs(vr.lengthText?.simpleText),
          kind: 'song',
          cover: vr.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
          link: `https://music.youtube.com/watch?v=${vr.videoId}`
        });
      } else if (item.lockupViewModel) {
        const vm = item.lockupViewModel;
        const id = vm.contentId;
        const title = vm.metadata?.lockupMetadataViewModel?.title?.content || '';
        const artists = vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || 'Various Artists';
        const cover = vm.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        if (id && title) {
          results.push({
            id,
            title,
            artists,
            album: '',
            duration: 210,
            kind: 'song',
            cover,
            link: `https://music.youtube.com/watch?v=${id}`
          });
        }
      }
    }

    if (results.length < 5 && artistHint) {
      const more = await searchYouTube(`${artistHint} song`);
      for (const t of more) {
        if (t.id !== videoId && !results.some(r => r.id === t.id)) {
          results.push(t);
        }
      }
    }

    return results;
  } catch (err) {
    console.error('getRelatedSongs error:', err);
    if (artistHint) return searchYouTube(`${artistHint} hits`);
    return [];
  }
}

// Curated Shelves Cache
let homeCache = null;
let homeCacheTime = 0;

async function getHomeSections() {
  const homePaths = [
    path.join(__dirname, 'data', 'home.json'),
    path.join(__dirname, 'public', 'home.json'),
    path.join(__dirname, 'home.json')
  ];
  for (const hp of homePaths) {
    if (fs.existsSync(hp)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(hp, 'utf8'));
        if (parsed.sections && parsed.sections.length > 0) {
          return parsed.sections;
        }
      } catch (e) {
        console.error('Error reading home file:', hp, e);
      }
    }
  }

  const now = Date.now();
  if (homeCache && now - homeCacheTime < 3600000) {
    return homeCache;
  }

  const shelfDefs = [
    { key: 'web-shelf-hindi', query: 'Hindi Hits Bollywood Songs official audio' },
    { key: 'web-shelf-arijit', query: 'Arijit Singh Best Songs official audio' },
    { key: 'web-shelf-romance', query: 'Romantic Hindi Songs official audio' },
    { key: 'web-shelf-nostalgia', query: '90s Bollywood Evergreen Songs official' }
  ];

  const sections = [];
  for (const shelf of shelfDefs) {
    const items = await searchYouTube(shelf.query);
    sections.push({
      key: shelf.key,
      items: items.filter(it => !it.duration || it.duration < 900).slice(0, 12)
    });
  }

  homeCache = sections;
  homeCacheTime = now;
  return sections;
}

// REST Endpoints
app.get('/api/bootstrap', (req, res) => {
  let bootstrapData = {};
  if (fs.existsSync(BOOTSTRAP_FILE)) {
    try {
      bootstrapData = JSON.parse(fs.readFileSync(BOOTSTRAP_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading bootstrap:', e);
    }
  }

  const storage = readStorage();
  const account = storage.account?.signedIn ? storage.account : null;

  res.json({
    ...bootstrapData,
    token: 'local-token-' + Date.now(),
    connected: true,
    hosted: true,
    catalogAvailable: true,
    googleEnabled: true,
    browserAccount: account,
    sessionUrl: `ws://${req.headers.host || 'localhost:3000'}/ws`,
    storage: {
      collections: storage.collections || [],
      saved: storage.saved || [],
      recents: storage.recents || [],
      account: storage.account
    }
  });
});

app.get('/api/home', async (req, res) => {
  const sections = await getHomeSections();
  res.json({ sections });
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const results = await searchYouTube(q);
  res.json(results);
});

app.get('/api/related', async (req, res) => {
  const videoId = req.query.videoId;
  const artist = req.query.artist || '';
  if (!videoId) return res.json([]);
  const related = await getRelatedSongs(videoId, artist);
  res.json(related);
});

app.get('/api/web-lyrics', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const artist = String(req.query.artist || '').trim();
  if (!title) return res.json({ lines: [] });

  try {
    const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/official|video|audio|lyrics/gi, '').trim();
    const cleanArtist = artist.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();

    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
      const searchData = await searchRes.json();
      if (Array.isArray(searchData) && searchData.length > 0) {
        const item = searchData[0];
        return res.json(formatLyricsResponse(item.syncedLyrics, item.plainLyrics));
      }
      return res.json({ lines: [] });
    }
    const data = await response.json();
    res.json(formatLyricsResponse(data.syncedLyrics, data.plainLyrics));
  } catch (err) {
    console.error('Lyrics error:', err);
    res.json({ lines: [] });
  }
});

function formatLyricsResponse(syncedLyrics, plainLyrics) {
  if (syncedLyrics) {
    const lines = [];
    const raw = syncedLyrics.split('\n');
    for (const r of raw) {
      const m = r.match(/^\[(\d+):(\d+\.?\d*)\](.*)$/);
      if (m) {
        const start_ms = Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000);
        const text = m[3].trim();
        if (text) lines.push({ text, start_ms });
      }
    }
    if (lines.length > 0) return { lines };
  }
  if (plainLyrics) {
    const lines = plainLyrics.split('\n').map(t => ({ text: t.trim() })).filter(l => l.text);
    return { lines };
  }
  return { lines: [] };
}

app.get('/api/provider-status', (req, res) => {
  const storage = readStorage();
  res.json({
    status: 'ready',
    current: Boolean(storage.account?.signedIn),
    stored: true,
    unavailable: false
  });
});

app.post('/api/action', (req, res) => {
  const { action } = req.body || {};
  if (action === 'sign-out-google') {
    const storage = readStorage();
    if (storage.account) {
      storage.account.signedIn = false;
    }
    writeStorage(storage);
  }
  res.json({ ok: true });
});

// YouTube Music Sign-In / Account routes
app.get('/api/google/start', (req, res) => {
  res.redirect('/#settings');
});

app.all('/api/google/signin', (req, res) => {
  const { name, email } = req.body || req.query || {};
  const storage = readStorage();
  storage.account = {
    name: name || 'YouTube Music User',
    email: email || 'user@music.youtube.com',
    avatar: (name || 'Y')[0].toUpperCase(),
    signedIn: true,
    connectedAt: Date.now()
  };
  writeStorage(storage);
  res.json({ ok: true, account: storage.account });
});

app.all('/api/google/signout', (req, res) => {
  const storage = readStorage();
  if (storage.account) {
    storage.account.signedIn = false;
  }
  writeStorage(storage);
  res.json({ ok: true });
});

// Two-way synchronization with local PC hard drive storage
app.post('/api/storage/sync', (req, res) => {
  const { collections, saved, recents, preferences } = req.body;
  const storage = readStorage();
  if (Array.isArray(collections)) storage.collections = collections;
  if (Array.isArray(saved)) storage.saved = saved;
  if (Array.isArray(recents)) storage.recents = recents;
  if (preferences) storage.preferences = preferences;
  writeStorage(storage);
  res.json({ ok: true });
});

// SSE Events stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// Fallback to SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket Server for Group Listening Sessions
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'join' || data.type === 'create') {
        currentRoom = data.room || 'default';
        if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set());
        rooms.get(currentRoom).add(ws);
        ws.send(JSON.stringify({ type: 'joined', room: currentRoom }));
      } else if (data.type === 'broadcast' && currentRoom) {
        const clients = rooms.get(currentRoom) || [];
        for (const client of clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify(data));
          }
        }
      }
    } catch (e) {
      console.error('WS Error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
    }
  });
});

// UDP Discovery Service for Mobile Phone App Auto-Connect
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const localIp = getLocalIp();

if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  try {
    const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpServer.on('error', (err) => {
      console.warn('UDP Discovery error:', err.message);
    });
    udpServer.on('message', (msg, rinfo) => {
      const text = msg.toString().trim();
      if (text.includes('DISCOVER')) {
        const response = Buffer.from(`http://${localIp}:${PORT}`);
        udpServer.send(response, rinfo.port, rinfo.address, (err) => {
          if (!err) console.log(`[UDP] Responded to discovery from ${rinfo.address}:${rinfo.port} -> http://${localIp}:${PORT}`);
        });
      }
    });
    udpServer.bind(PORT, () => {
      try { udpServer.setBroadcast(true); } catch {}
      console.log(`[UDP] Discovery listening on port ${PORT}`);
    });
  } catch (e) {
    console.warn('Could not bind UDP discovery socket:', e.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Warrior Music Server running on:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://${localIp}:${PORT}`);
  });
}

export default app;
export { app };
