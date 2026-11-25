import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appOriginPath = path.join(__dirname, 'public', 'app.origin.js');
const appDestPath = path.join(__dirname, 'public', 'app.js');

const bootstrapData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'bootstrap.json'), 'utf8'));
const homeData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'home.json'), 'utf8'));

let code = fs.readFileSync(appOriginPath, 'utf8');

// 1. Add default embedded copy and home data at top + helpers
const helperCode = `
const DEFAULT_COPY = ${JSON.stringify(bootstrapData.copy)};
const DEFAULT_HOME = ${JSON.stringify(homeData.sections || [])};

async function syncToPcStorage() {
  try {
    await api('storage/sync', {
      collections: state.collections,
      saved: state.saved,
      recents: state.queue.previous || local.history,
      preferences
    });
  } catch (err) {
    console.warn('Storage sync failed:', err);
  }
}

function updateProfileAvatar() {
  const profileBtn = document.querySelector('.profile-btn');
  if (profileBtn) {
    if (state.browserAccount?.signedIn && state.browserAccount?.name) {
      if (state.browserAccount.name.toLowerCase().includes('vishesh')) {
        profileBtn.innerHTML = '<img src="/assets/vishesh.png" alt="' + esc(state.browserAccount.name) + '" class="profile-avatar-img">';
      } else {
        profileBtn.innerHTML = '<span>' + esc(state.browserAccount.name[0].toUpperCase()) + '</span>';
      }
    } else {
      profileBtn.innerHTML = '<img src="/assets/logo.svg" alt="Warrior Music" class="profile-avatar-img">';
    }
  }
}
`;

code = helperCode + code;

// 1b. In state definition, use DEFAULT_COPY and DEFAULT_HOME
code = code.replace(
  "token: '', copy: {}, connected: false,",
  "token: 'warrior_token', copy: DEFAULT_COPY, connected: true, hosted: true, home: DEFAULT_HOME, loading: false,"
);

// 1c. Enhance api() with Netlify & Static Hosting Fallback
const oldApi = `async function api(route, data) {
  const response = await fetch(\`/api/\${route}\`, data ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Novax-Key': state.token }, body: JSON.stringify(data),
  } : { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'request_failed');
  return value;
}`;

const newApi = `async function api(route, data) {
  try {
    const response = await fetch(\`/api/\${route}\`, data ? {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Novax-Key': state.token }, body: JSON.stringify(data),
    } : { cache: 'no-store' });
    if (response.ok) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return await response.json();
      }
    }
    throw new Error('API request failed with status ' + response.status);
  } catch (err) {
    // Netlify / Static Hosting Fallback
    if (route === 'bootstrap') {
      try {
        const r = await fetch('/bootstrap.json');
        if (r.ok) return await r.json();
      } catch {}
      return {
        token: 'warrior_token',
        copy: DEFAULT_COPY,
        connected: false,
        hosted: true,
        catalogAvailable: true,
        googleEnabled: true,
        browserAccount: null
      };
    }
    if (route === 'home') {
      try {
        const r = await fetch('/home.json');
        if (r.ok) return await r.json();
      } catch {}
      return { sections: DEFAULT_HOME };
    }
    if (route.startsWith('search')) {
      const url = new URL('http://dummy/' + route);
      const q = url.searchParams.get('query') || url.searchParams.get('q') || '';
      const fallbackTracks = [];
      const homeTracks = (state.home || DEFAULT_HOME).flatMap(s => s.items || []);
      const allTracks = [...homeTracks, ...(state.saved || []), ...(state.collections || []).flatMap(c => c.tracks || [])];
      for (const t of allTracks) {
        if (t.title?.toLowerCase().includes(q.toLowerCase()) || t.artists?.toLowerCase().includes(q.toLowerCase())) {
          if (!fallbackTracks.some(f => f.id === t.id)) fallbackTracks.push(t);
        }
      }
      return fallbackTracks;
    }
    if (route.startsWith('related')) {
      return ((state.home || DEFAULT_HOME)?.[0]?.items || []).slice(0, 10);
    }
    if (route === 'storage/sync' || route === 'google/signout' || route === 'provider-status') {
      return { ok: true, status: 'synced' };
    }
    throw err;
  }
}`;

code = code.replace(oldApi, newApi);

// 2. Enhance nextLocal with continuous smart auto-play based on current song
const oldNext = `  if (index >= local.queue.length) {
    if (local.repeat === 'all') index = 0;
    else { local.state = 'paused'; player.pause(); syncLocal(); updateProgress(); savePlayback(); shareListeningState(); return; }
  }`;

const newNext = `  if (index >= local.queue.length) {
    if (local.repeat === 'all') index = 0;
    else {
      const cur = localTrack();
      if (cur && cur.id) {
        toast('web-shelf-queue');
        api(\`related?videoId=\${encodeURIComponent(cur.id)}&artist=\${encodeURIComponent(cur.artists || '')}\`)
          .then(related => {
            if (Array.isArray(related) && related.length) {
              const historyIds = new Set(local.history.map(h => videoIdOf(h) || h.id));
              const unplayed = related.filter(r => !historyIds.has(r.id));
              const toAdd = unplayed.length ? unplayed : related;
              local.queue.push(...toAdd);
              syncLocal();
              playLocal(index);
            } else {
              local.state = 'paused'; player.pause(); syncLocal(); updateProgress(); savePlayback(); shareListeningState();
            }
          }).catch(() => {
            local.state = 'paused'; player.pause(); syncLocal(); updateProgress(); savePlayback(); shareListeningState();
          });
        return;
      }
      local.state = 'paused'; player.pause(); syncLocal(); updateProgress(); savePlayback(); shareListeningState(); return;
    }
  }`;

code = code.replace(oldNext, newNext);

// 3. Sync to PC storage on remember(track)
code = code.replace(
  "local.history = [track, ...local.history.filter(item => videoIdOf(item) !== key)].slice(0, 50);\n  refreshQueue();",
  "local.history = [track, ...local.history.filter(item => videoIdOf(item) !== key)].slice(0, 50);\n  refreshQueue();\n  syncToPcStorage();"
);

// 4. Add syncToPcStorage to saved, collections mutations
code = code.replace(
  "localStorage.setItem('novax-saved', JSON.stringify(state.saved));",
  "localStorage.setItem('novax-saved', JSON.stringify(state.saved)); syncToPcStorage();"
);

code = code.replace(
  "localStorage.setItem('novax-collections', JSON.stringify(state.collections));",
  "localStorage.setItem('novax-collections', JSON.stringify(state.collections)); syncToPcStorage();"
);

// 5. Replace Brand logo & name in shell()
code = code.replace(
  "<span>NovaX<small>CLOUD</small></span>",
  "<span>Warrior<small>MUSIC</small></span>"
);

// 6. Update Owner Modal to Vishesh with Discord link & Avatar
const oldAboutModal = `h3 class="modal-section-title">\${label('music-owners-title')}</h3>\${[['divyang','music-owner-divyang','1421764734809542738'],['rahul','music-owner-rahul','1532758800657027083']].map(([image, name, id]) => \`<div class="owner-row"><img src="/assets/\${image}.png" alt=""><div><strong>\${label(name)}</strong><p>\${label('music-owner-role')}</p></div><a class="pill" href="https://discord.com/users/\${id}" target="_blank" rel="noopener noreferrer">\${label('music-owner-message')}</a></div>\`).join('')}<h3 class="modal-section-title">\${label('music-community-title')}</h3><div class="community-card"><img src="/assets/community.png" alt=""><div><strong>\${label('music-community-name')}</strong><p>\${label('music-community-detail')}</p></div><a class="solid green" href="https://discord.gg/nbtRKNvY57" target="_blank" rel="noopener noreferrer">\${label('music-community-join')}</a></div>`;

const newAboutModal = `h3 class="modal-section-title">\${label('music-owners-title')}</h3><div class="owner-row"><img src="/assets/vishesh.png" alt="Vishesh" style="border-radius:50%;object-fit:cover;border:2px solid #5865F2"><div><strong>__VISHESH__</strong><p>Owner · @10vishesh23</p></div><a class="pill" href="https://discord.com/users/10vishesh23" target="_blank" rel="noopener noreferrer">DM on Discord</a></div><h3 class="modal-section-title">\${label('music-community-title')}</h3><div class="community-card"><img src="/assets/community.png" alt="WARRIOR MUSIC" style="border-radius:12px;object-fit:cover"><div><strong>WARRIOR MUSIC</strong><p>Join our official Discord community for music, updates, and support.</p></div><a class="solid green" href="https://discord.gg/cFWffVsCX" target="_blank" rel="noopener noreferrer">Join Discord</a></div>`;

code = code.replace(oldAboutModal, newAboutModal);

// 7. Replace Profile button initial HTML in shell()
code = code.replace(
  `<button class="profile-btn" data-action="account" title="\${label('web-account')}" aria-label="\${label('web-account')}"><span>N</span></button>`,
  `<button class="profile-btn" data-action="account" title="\${label('web-account')}" aria-label="\${label('web-account')}"><img src="/assets/logo.svg" alt="Warrior Music" class="profile-avatar-img"></button>`
);

// 8. Download links in install modal
code = code.replace(
  'href="/downloads/NovaXCloudMusic-SetupV3.exe" download',
  'href="/downloads/WarriorMusic-Setup.exe" download="WarriorMusic-Setup.exe"'
);
code = code.replace(
  'href="/downloads/NovaXCloudMusic.apk" download',
  'href="/downloads/WarriorMusic.apk" download="WarriorMusic.apk"'
);

// 9. Add signout action handler in app.js
const actMarker = "else if (action === 'sign-in-google') {";
const newActions = `else if (action === 'sign-out') {
    try {
      await api('google/signout');
      state.browserAccount = null;
      updateConnection();
      updateProfileAvatar();
      if (state.page === 'settings') renderPage();
      toast('web-google-sign-out');
    } catch {
      toast('web-request-failed');
    }
  }
  else if (action === 'sign-in-google') {`;

code = code.replace(actMarker, newActions);

// 10. Completely replace start() with immediate shell render (ZERO POPUP, ZERO RELOAD BUTTON)
const oldStartFunc = code.slice(code.indexOf('async function start() {'));
const newStartFunc = `async function start() {
  applyPreferences();
  if (location.hash === '#settings') state.page = 'settings';
  if (window.matchMedia('(max-width: 800px)').matches && localStorage.getItem('novax-layout-right') === null) state.right = false;
  restorePlayback();
  
  // Render the music player immediately — zero reload buttons, zero popups!
  try {
    shell();
    updateProfileAvatar();
  } catch (err) {
    console.error('Initial shell render:', err);
  }

  // Load home recommendations
  loadHome().catch(() => {});

  // Background hydration from server / Netlify API
  api('bootstrap').then(bootstrap => {
    if (!bootstrap) return;
    Object.assign(state, {
      token: bootstrap.token || state.token,
      copy: Object.assign({}, state.copy, bootstrap.copy),
      connected: bootstrap.connected ?? state.connected,
      googleEnabled: bootstrap.googleEnabled ?? state.googleEnabled,
      browserAccount: bootstrap.browserAccount ?? state.browserAccount,
      hosted: bootstrap.hosted ?? state.hosted,
      catalogAvailable: bootstrap.catalogAvailable ?? state.catalogAvailable,
      sessionUrl: bootstrap.sessionUrl || state.sessionUrl,
    });
    if (bootstrap.storage) {
      if (bootstrap.storage.collections?.length && !state.collections.length) {
        state.collections = bootstrap.storage.collections;
        localStorage.setItem('novax-collections', JSON.stringify(state.collections));
      }
      if (bootstrap.storage.saved?.length && !state.saved.length) {
        state.saved = bootstrap.storage.saved;
        localStorage.setItem('novax-saved', JSON.stringify(state.saved));
      }
      if (bootstrap.storage.recents?.length && !local.history.length) {
        local.history = bootstrap.storage.recents;
      }
      if (bootstrap.storage.account?.signedIn) {
        state.browserAccount = bootstrap.storage.account;
      }
    }
    renderLibrary();
    if (state.page === 'home') renderPage();
    updateConnection();
    updateProfileAvatar();
    if (state.right && localTrack()) refreshLyrics();
    if (state.page === 'settings') refreshProviderStatus();
    if (!state.hosted) watchDesktop();
  }).catch(e => console.warn('Bootstrap background note:', e));

  setInterval(updateProgress, 250);
}

function watchDesktop() {
  try {
    const events = new EventSource('/api/events');
    events.onmessage = event => {
      try {
        const value = JSON.parse(event.data);
        const wasConnected = state.connected;
        if (value.connected !== state.connected) { state.connected = value.connected; updateConnection(); }
        if (!wasConnected && value.connected && !state.home.length) loadHome();
        if (!wasConnected && value.connected && state.page === 'settings') refreshProviderStatus();
      } catch {}
    };
  } catch {}
}

start();
`;

code = code.slice(0, code.indexOf('async function start() {')) + newStartFunc;

// 12. Replace any user-facing NovaX text with Warrior Music
code = code.replaceAll('NovaXCloud Music', 'Warrior Music');
code = code.replaceAll('NovaXCloud', 'Warrior Music');
code = code.replaceAll('NovaX', 'Warrior');

fs.writeFileSync(appDestPath, code, 'utf8');
console.log('Successfully written app.js! Size:', code.length);
