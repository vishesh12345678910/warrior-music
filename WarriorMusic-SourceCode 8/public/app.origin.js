import { BrowserPlayer } from './player.js';
import { ListeningRoom } from './listening.js';

const app = document.querySelector('#app');
const overlays = document.querySelector('#overlays');
const toastNode = document.querySelector('#toast');
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

/** The desktop engine is asked for search results only; playback belongs to this page. */
const audioHost = document.createElement('div');
audioHost.className = 'browser-audio';
audioHost.setAttribute('aria-hidden', 'true');
document.body.append(audioHost);
const local = {
  queue: [], index: -1, history: [],
  state: 'paused', position: 0, duration: 0, loaded: false, seekUntil: 0,
  volume: stored('novax-player-volume', 70), muted: false,
  shuffle: stored('novax-player-shuffle', false), repeat: stored('novax-player-repeat', 'off'),
};
const player = new BrowserPlayer(audioHost, {
  change: value => {
    local.state = value;
    if (value === 'playing') {
      remember(localTrack());
      if (publishAfterLoad) { publishAfterLoad = false; shareListeningState(); }
    }
    if (value === 'paused') updateProgress();
    syncLocal();
    savePlayback();
  },
  ended: () => localEnded(),
  error: code => {
    console.warn('novax-play-failed', code);
    local.loaded = false;
    local.state = 'paused';
    syncLocal();
    toast('web-play-failed');
  },
});
player.volume(local.volume);
player.mute(local.muted);
const state = {
  token: '', copy: {}, connected: false, current: null, queue: { previous: [], upcoming: [], current: null },
  googleEnabled: false, browserAccount: null, searchFailed: false,
  hosted: false, catalogAvailable: false, sessionUrl: '',
  home: [], loading: true, page: 'home', filter: 'all', query: '', searchKind: '', hits: [], searching: false, picksPage: 0,
  pane: 'now', right: stored('novax-layout-right', false), collapsed: stored('novax-layout-collapsed', false),
  saved: stored('novax-saved', []), collections: stored('novax-collections', []), collection: null,
  lyrics: null, tracks: new Map(), history: [], forward: [],
};
const preferenceDefaults = { theme: 'system', motion: false, centered: true, remaining: false, lyrics: true };
const preferences = { ...preferenceDefaults, ...stored('novax-web-preferences', {}) };
const settingsGroups = {
  general: { icon: 'settings', sections: ['providers', 'general', 'about'] },
  appearance: { icon: 'palette', sections: ['appearance', 'player-bar', 'now-playing'] },
  lyrics: { icon: 'mic-vocal', sections: ['lyrics'] },
  playback: { icon: 'play', sections: ['playback', 'sound', 'storage'] },
  integrations: { icon: 'link', sections: ['integrations'] },
  keybinds: { icon: 'keyboard', sections: ['keybinds'] },
};
const desktopActions = ['open-desktop', 'open-desktop-account', 'open-desktop-settings', 'open-desktop-storage', 'open-desktop-discord', 'open-desktop-scrobbling'];
const systemTheme = matchMedia('(prefers-color-scheme: light)');
if (!['system', 'dark', 'light'].includes(preferences.theme)) preferences.theme = 'system';
let settingsTab = 'general';
let providerStatus = null;
let publishAfterLoad = false;
let pendingRoom = false;
const listening = new ListeningRoom({
  changed: (room, created) => {
    pendingRoom = false;
    renderPlayer();
    if (document.querySelector('.session-modal')) sessionDialog();
    if (created) shareListeningState();
  },
  received: followListeningState,
  failed: reason => {
    pendingRoom = false;
    if (document.querySelector('.session-modal')) sessionDialog();
    toast(reason === 'not_found' ? 'web-session-not-found' : reason === 'ended' ? 'web-session-ended' : 'web-session-unavailable');
  },
});
const t = key => state.copy[key] || key.replace(/^web-/, '').replaceAll('-', ' ');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const ic = name => `<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#${esc(name)}"></use></svg>`;
const label = key => esc(t(key));
const button = (action, icon, key, extra = '') => `<button class="icon-btn" data-action="${action}" title="${label(key)}" aria-label="${label(key)}" ${extra}>${ic(icon)}</button>`;
const clock = value => { const seconds = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const endClock = (duration, position) => preferences.remaining && duration
  ? `−${clock(Math.max(0, duration - position))}`
  : clock(duration);
function trackKey(track) {
  const key = track.link || track.id || track.title;
  state.tracks.set(key, track); return key;
}
function currentTrack() {
  if (!state.current?.track) return null;
  const track = state.current.track;
  return { ...track, artists: Array.isArray(track.artists) ? track.artists.join(', ') : track.artists,
    link: `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}`, kind: 'song' };
}
function artwork(track, extra = '') {
  const first = Array.from(track?.title || track?.name || 'N')[0];
  return track?.cover ? `<img src="${esc(track.cover)}" alt="" loading="lazy" decoding="async" data-letter="${esc(first)}" ${extra}>` : `<span class="art-fallback">${esc(first)}</span>`;
}
const empty = (title, detail, icon = 'disc-3', action = '') => `<div class="empty">${ic(icon)}<h2>${label(title)}</h2><p>${label(detail)}</p>${action}</div>`;
function toast(key) {
  toastNode.textContent = t(key); toastNode.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => toastNode.classList.remove('visible'), 3300);
}
async function api(route, data) {
  const response = await fetch(`/api/${route}`, data ? {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Novax-Key': state.token }, body: JSON.stringify(data),
  } : { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'request_failed');
  return value;
}
const videoIdOf = track => {
  const direct = String(track?.id || '');
  if (/^[\w-]{11}$/.test(direct)) return direct;
  try {
    const id = new URL(track?.link || '').searchParams.get('v');
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
};
function localTrack() { return local.queue[local.index] || null; }
const playbackKey = 'novax-web-playback';
const playbackSaveInterval = 4000;
let savedPosition = 0;
let savedDuration = 0;
let lastPlaybackSave = 0;
let playRequest = 0;

/** Restore controls and recent tracks without loading or starting the embedded player. */
function restorePlayback() {
  const saved = stored(playbackKey, null);
  if (!saved) return;
  const queue = Array.isArray(saved.queue) ? saved.queue : [];
  const index = Number.isInteger(saved.index) && videoIdOf(queue[saved.index]) ? saved.index : -1;
  local.queue = queue.filter(track => videoIdOf(track));
  local.index = index < 0 ? -1 : queue.slice(0, index).filter(track => videoIdOf(track)).length;
  local.history = Array.isArray(saved.history) ? saved.history.filter(track => videoIdOf(track)).slice(0, 50) : [];
  local.position = savedPosition = index >= 0 && Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0;
  local.duration = savedDuration = index >= 0 && Number.isFinite(saved.duration) ? Math.max(0, saved.duration) : 0;
  local.muted = Boolean(saved.muted);
  player.mute(local.muted);
  state.current = localCurrent();
  refreshQueue();
}

function savePlayback() {
  const { queue, index, history, position, duration, muted } = local;
  try {
    localStorage.setItem(playbackKey, JSON.stringify({ queue, index, history, position, duration, muted }));
    savedPosition = position;
    savedDuration = duration;
  } catch { /* Storage can be unavailable in a restricted browser profile. */ }
  lastPlaybackSave = performance.now();
}

function checkpointPlayback(force = false) {
  if (!local.loaded || (local.position === savedPosition && local.duration === savedDuration)) return;
  if (force || performance.now() - lastPlaybackSave >= playbackSaveInterval) savePlayback();
}

function localCurrent() {
  const track = localTrack();
  if (!track) return null;
  return {
    track, state: local.state, position: local.position,
    volume: local.volume, muted: local.muted,
    shuffle: local.shuffle, repeat: local.repeat,
    liked: state.saved.some(item => item.id === track.id),
    origin: null,
  };
}
/// The phone shell mirrors the browser queue into its media notification and lock screen.
let nativeSignature = '';
function syncNative() {
  const bridge = window.Native;
  if (!bridge || typeof bridge.nowPlaying !== 'function') return;
  const current = state.current, track = current?.track;
  const payload = !track ? { active: false } : {
    active: true,
    title: track.title || '',
    artist: Array.isArray(track.artists) ? track.artists.join(', ') : (track.artists || ''),
    art: track.cover ? new URL(track.cover, location.href).href : '',
    playing: current.state === 'playing',
    position: Math.round((current.position || 0) * 1000),
    duration: Math.round((local.duration || track.duration || 0) * 1000),
  };
  const json = JSON.stringify(payload);
  if (json === nativeSignature) return;
  nativeSignature = json;
  try { bridge.nowPlaying(json); } catch { /* an older shell without the bridge */ }
}
function syncLocal(render = true) {
  state.current = localCurrent();
  if (!render) { renderPip(); syncNative(); return; }
  renderPlayer(); if (state.right) renderRight();
  renderPip(); syncNative();
}
function remember(track) {
  if (!track) return;
  const key = videoIdOf(track);
  if (!key || videoIdOf(local.history[0]) === key) return;
  local.history = [track, ...local.history.filter(item => videoIdOf(item) !== key)].slice(0, 50);
  refreshQueue();
}
function playLocal(index, resume = false, share = true) {
  const track = local.queue[index];
  if (!track) return;
  const id = videoIdOf(track);
  if (!id) { toast('web-play-failed'); return; }
  const request = ++playRequest;
  publishAfterLoad = share;
  local.index = index;
  local.state = 'loading';
  local.loaded = true;
  if (!resume) {
    local.position = 0;
    local.duration = Number(track.duration) || 0;
  } else if (local.duration && local.position >= local.duration - 1) {
    local.position = 0;
  }
  local.seekUntil = 0;
  syncLocal(); refreshQueue(); refreshLyrics();
  savePlayback();
  player.load(id, { start: local.position }).catch(() => {
    if (request !== playRequest) return;
    local.loaded = false;
    local.state = 'paused';
    syncLocal();
    toast('web-play-failed');
  });
}
function playFrom(target, key) {
  const group = target.closest('.shelf-track,.results-grid,.track-list,.quick-grid,.picks-grid');
  const keys = group ? [...new Set([...group.querySelectorAll('[data-key]')].map(node => node.dataset.key))] : [key];
  // Artist and playlist cards can share a grid with songs, but only songs belong in the queue.
  const tracks = keys.map(value => state.tracks.get(value)).filter(track => track && videoIdOf(track));
  const clicked = state.tracks.get(key);
  if (clicked && videoIdOf(clicked) && !tracks.includes(clicked)) tracks.unshift(clicked);
  if (!tracks.length) return;
  local.queue = tracks;
  playLocal(Math.max(0, tracks.indexOf(clicked || tracks[0])));
}
/// An artist card has no video, so tapping it searches for that artist instead of failing.
function playOrSearch(target, key) {
  const track = state.tracks.get(key);
  if (!track) return;
  if (videoIdOf(track)) { playFrom(target, key); return; }
  if (track.kind !== 'artist') { toast('web-play-failed'); return; }
  const input = document.querySelector('#global-search');
  if (input) input.value = track.title;
  state.searchKind = 'song';
  navigate('search');
  doSearch();
}
function nextLocal() {
  if (!local.queue.length) return;
  let index;
  if (local.shuffle && local.queue.length > 1) {
    do { index = Math.floor(Math.random() * local.queue.length); } while (index === local.index);
  } else index = local.index + 1;
  if (index >= local.queue.length) {
    if (local.repeat === 'all') index = 0;
    else { local.state = 'paused'; player.pause(); syncLocal(); updateProgress(); savePlayback(); shareListeningState(); return; }
  }
  playLocal(index);
}
function previousLocal() {
  if (!localTrack()) return;
  if (local.position > 3 || local.index <= 0) { act('seek', { seconds: 0 }); return; }
  playLocal(local.index - 1);
}
function localEnded() {
  if (local.repeat === 'one') {
    local.position = 0; local.seekUntil = performance.now() + 1000;
    player.seek(0); player.play(); savePlayback(); shareListeningState();
    return;
  }
  nextLocal();
}

function sessionTrack(track) {
  const id = videoIdOf(track);
  if (!id) return null;
  return {
    id, name: track.title, artists: track.artists || '', album: track.album || '', playable: true,
    cover: /^https:\/\//.test(track.cover || '') ? track.cover : null,
    duration: { secs: Math.max(0, Math.floor(track.duration || 0)), nanos: 0 },
  };
}

function shareListeningState() {
  if (!listening.room) return;
  listening.publish({
    track: sessionTrack(localTrack()),
    upcoming: local.queue.slice(local.index + 1, local.index + 101).map(sessionTrack).filter(Boolean),
    playing: local.state === 'playing',
    position: Math.max(0, Math.round(local.position * 1000)),
  });
}

function fromSessionTrack(track) {
  const id = videoIdOf(track);
  if (!id) return null;
  return {
    id, kind: 'song', title: track.name || id, artists: track.artists || '', album: track.album || '',
    duration: Number(track.duration?.secs) || 0,
    cover: /^https:\/\//.test(track.cover || '') ? track.cover : null,
    link: `https://music.youtube.com/watch?v=${id}`,
  };
}

/** Apply another listener's changes without sending them back as local playback events. */
function followListeningState(shared, position) {
  const track = fromSessionTrack(shared.track);
  const same = track && track.id === videoIdOf(localTrack());
  publishAfterLoad = false;
  const upcoming = (shared.upcoming || []).slice(0, 100).map(fromSessionTrack).filter(Boolean);
  const previous = same ? local.queue.slice(0, local.index) : [];
  local.queue = track ? [...previous, track, ...upcoming] : upcoming;
  local.index = track ? previous.length : -1;
  if (!same || !shared.playing) {
    local.loaded = Boolean(same && local.loaded);
    if (!shared.playing || !track) player.pause();
  }
  if (!same || Math.abs(local.position - position) > 1) {
    local.duration = same ? local.duration : track?.duration || 0;
    local.position = track ? Math.min(Math.max(0, position || 0), local.duration || Infinity) : 0;
    local.seekUntil = performance.now() + 1000;
    if (local.loaded) player.seek(local.position);
  }
  if (shared.playing && track && !local.loaded) {
    playLocal(local.index, true, false);
    return;
  }
  if (shared.playing && track && local.state !== 'playing') player.play();
  local.state = shared.playing && track ? 'playing' : 'paused';
  syncLocal(); refreshQueue(); savePlayback();
}

async function act(action, detail = {}) {
  try {
    if (desktopActions.includes(action)) {
      await api('action', { action });
      toast('web-engine-starting');
      if (!state.connected && state.page === 'home') setTimeout(loadHome, 3000);
      return true;
    }
    if (action === 'play-item') {
      const links = detail.links || [detail.link];
      const tracks = links.map(link => state.tracks.get(link)).filter(Boolean);
      if (!tracks.length) return null;
      local.queue = tracks; playLocal(0);
      return true;
    }
    if (action === 'queue-item' || action === 'next-item') {
      const track = state.tracks.get(detail.link);
      if (!track) return null;
      const at = local.index < 0 ? local.queue.length : local.index + (action === 'next-item' ? 1 : local.queue.length - local.index);
      local.queue.splice(at, 0, track);
      refreshQueue(); savePlayback(); shareListeningState(); toast('web-added');
      return true;
    }
    if (action === 'next') { nextLocal(); return true; }
    if (action === 'previous') { previousLocal(); return true; }
    if (action === 'toggle' || action === 'play' || action === 'pause') {
      if (!localTrack()) return null;
      if (local.state === 'loading') return null;
      const playing = action === 'play' || (action === 'toggle' && local.state !== 'playing');
      if (playing && !local.loaded) { playLocal(local.index, true); return true; }
      if (playing) { player.play(); local.state = 'playing'; }
      else { player.pause(); local.state = 'paused'; }
      updateProgress();
      syncLocal();
      savePlayback();
      shareListeningState();
      return true;
    }
    if (action === 'seek') {
      const seconds = Number(detail.seconds);
      if (!Number.isFinite(seconds) || !localTrack()) return null;
      const position = Math.max(0, seconds);
      local.position = local.duration ? Math.min(position, local.duration) : position;
      local.seekUntil = performance.now() + 1000;
      player.seek(local.position); syncLocal(false); updateProgress(false);
      savePlayback();
      shareListeningState();
      return true;
    }
    if (action === 'volume') {
      const value = Number(detail.value);
      if (!Number.isFinite(value)) return null;
      local.volume = Math.min(100, Math.max(0, Math.round(value)));
      if (local.volume > 0 && local.muted) { local.muted = false; savePlayback(); }
      localStorage.setItem('novax-player-volume', JSON.stringify(local.volume));
      player.volume(local.volume); player.mute(local.muted);
      syncLocal(false);
      const slider = document.querySelector('#volume');
      if (slider) {
        slider.value = local.volume;
        slider.style.setProperty('--progress', `${local.volume}%`);
      }
      updatePlaybackSetting('volume', local.volume);
      return true;
    }
    if (action === 'mute') {
      local.muted = !local.muted; player.mute(local.muted); syncLocal(); savePlayback();
      return true;
    }
    if (action === 'shuffle') {
      local.shuffle = !local.shuffle;
      localStorage.setItem('novax-player-shuffle', JSON.stringify(local.shuffle));
      syncLocal();
      updatePlaybackSetting('shuffle', local.shuffle);
      return true;
    }
    if (action === 'repeat') {
      const value = detail.value || (local.repeat === 'off' ? 'all' : local.repeat === 'all' ? 'one' : 'off');
      local.repeat = ['off', 'all', 'one'].includes(value) ? value : 'off';
      localStorage.setItem('novax-player-repeat', JSON.stringify(local.repeat));
      syncLocal();
      updatePlaybackSetting('repeat', local.repeat);
      return true;
    }
    if (action === 'like') {
      const track = localTrack();
      if (!track) return null;
      const index = state.saved.findIndex(item => item.id === track.id);
      if (index < 0) state.saved.unshift(track); else state.saved.splice(index, 1);
      localStorage.setItem('novax-saved', JSON.stringify(state.saved));
      syncLocal(); renderLibrary(); if (state.page === 'liked') renderPage();
      return { result: index < 0 };
    }
    return null;
  } catch (error) {
    if (error.message?.startsWith('engine_')) {
      state.connected = false; updateConnection(); toast('web-offline');
    } else toast('web-request-failed');
    return null;
  }
}
function shell() {
  app.innerHTML = `<div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#home" data-action="home" aria-label="${label('web-brand-name')}"><img src="/assets/logo.svg" alt=""><span>NovaXCloud<small>MUSIC</small></span></a>
      <div class="history-controls">${button('collapse', 'panel-left-close', 'web-collapse')}${button('back', 'chevron-left', 'web-back')}${button('forward', 'chevron-right', 'web-forward')}${button('refresh-page', 'refresh-cw', 'web-refresh')}</div>
      <div class="search-dock"><button class="icon-btn home-btn" data-action="home" aria-label="${label('web-home')}" title="${label('web-home')}">${ic('house')}</button>
        <form class="search-box" id="search-form" role="search">${ic('search')}<label class="sr-only" for="global-search">${label('web-search')}</label><input id="global-search" autocomplete="off" placeholder="${label('web-search-placeholder')}"><kbd class="search-key">/</kbd></form></div>
      <div class="top-tools"><div id="connection" class="connection"><span></span><small>${label('web-live')}</small></div><button class="install-app" data-action="install-app">${ic('arrow-down-circle')}<span>${label('web-install-app')}</span></button><span class="phone-session">${button('session-menu', 'users-round-collaboration', 'web-sessions')}</span><button class="profile-btn" data-action="account" title="${label('web-account')}" aria-label="${label('web-account')}"><span>N</span></button>${button('toggle-right', 'panel-right-close', 'web-now-view')}</div>
    </header>
    <div class="workspace" id="workspace"><aside class="panel library" aria-label="${label('web-library')}" id="library"></aside><main class="panel main-panel" id="main" tabindex="-1"></main><aside class="panel right-panel" id="right" aria-label="${label('web-now-playing')}"></aside></div>
    <footer class="player" id="player" aria-label="${label('web-now-playing')}"></footer>
    <div class="phone-scrim" data-action="close-library"></div>
    <nav class="phone-nav" id="phone-nav" aria-label="${label('web-library')}">
      <button data-action="home" data-phone="home">${ic('house')}<span>${label('web-home')}</span></button>
      <button data-action="phone-search" data-phone="search">${ic('search')}<span>${label('web-search')}</span></button>
      <button data-action="phone-library" data-phone="library">${ic('list-music')}<span>${label('web-library-nav')}</span></button>
      <button data-action="liked" data-phone="liked">${ic('heart')}<span>${label('web-liked-nav')}</span></button>
    </nav>
    <div class="pip-card" id="pip-card"></div>
  </div>`;
  document.title = t('web-brand-name');
  renderLibrary(); renderPage(); renderRight(); renderPlayer(); updateLayout(); updateConnection(); updatePhoneNav(); renderPip(); syncNative();
}
function updateLayout() {
  const workspace = document.querySelector('#workspace');
  workspace?.classList.toggle('no-right', !state.right); workspace?.classList.toggle('collapsed', state.collapsed);
  document.querySelector('#right')?.classList.toggle('hide', !state.right);
}
/// On a phone the library is a drawer, so the same list needs no second implementation.
function phoneLibrary(open) {
  document.querySelector('.app-shell')?.classList.toggle('phone-library', Boolean(open));
}
function updatePhoneNav() {
  document.querySelectorAll('#phone-nav [data-phone]').forEach(button => {
    button.classList.toggle('active', button.dataset.phone === state.page);
  });
}
/// The phone app's back button asks the page first, so it steps back a page instead of quitting.
window.novaxBack = () => {
  const shell = document.querySelector('.app-shell');
  if (shell?.classList.contains('phone-library')) { phoneLibrary(false); return true; }
  if (state.page === 'home') return false;
  closeOverlay(); navigate('home'); return true;
};
/// Notification and lock-screen buttons are forwarded here by the phone shell.
window.novaxCommand = action => {
  if (!['toggle', 'play', 'pause', 'next', 'previous'].includes(action)) return false;
  act(action);
  return true;
};
/// The shell switches to a compact now-playing view while it floats in picture-in-picture.
window.novaxPip = active => document.documentElement.classList.toggle('pip', Boolean(active));
window.novaxDebug = () => ({ state: local.state, position: Math.round(local.position), ready: player.ready, queue: local.queue.length, now: localTrack()?.title || '' });
/** Only a choice the listener makes is remembered: a narrow first visit must not hide the panel for good. */
function saveLayout() {
  localStorage.setItem('novax-layout-right', JSON.stringify(state.right));
  localStorage.setItem('novax-layout-collapsed', JSON.stringify(state.collapsed));
}
function updateConnection() {
  const node = document.querySelector('#connection');
  if (!node) return;
  const canSearch = state.connected || state.catalogAvailable || Boolean(state.browserAccount);
  node.classList.toggle('offline', !canSearch);
  node.innerHTML = `<span></span><small>${label(canSearch ? 'web-live' : 'web-offline')}</small>`;
  const banner = document.querySelector('.offline-banner');
  const catalogEmpty = document.querySelector('.catalog-empty');
  if (banner) banner.hidden = canSearch;
  if (catalogEmpty) catalogEmpty.hidden = !canSearch;
  if (!state.connected) providerStatus = null;
  updateProviderStatus();
}
function renderLibrary(filter = '') {
  const node = document.querySelector('#library'); if (!node) return;
  node.innerHTML = `<div class="library-head"><button class="library-title" data-action="collapse" title="${label('web-collapse')}">${ic('list-music')}<span>${label('web-library')}</span></button><button class="create-btn" data-action="create">${ic('plus')}${label('web-create')}</button><button class="icon-btn phone-close" data-action="close-library" aria-label="${label('web-close')}">${ic('x')}</button></div>
    <div class="library-filters"><button class="pill" data-action="collections">${label('web-playlists')}</button></div>
    <div class="library-sort"><div class="flex">${button('library-search', 'search', 'web-search')}<input id="library-query" aria-label="${label('web-search')}" value="${esc(filter)}"></div><button class="sort-btn" data-action="recents">${label('web-recents')}${ic('list-music')}</button></div>
    <div class="library-items"><button class="library-item ${state.page === 'liked' ? 'selected' : ''}" data-action="liked" title="${label('web-liked')}"><span class="library-art liked-art">${ic('heart-filled')}</span><span class="library-info"><strong>${label('web-liked')}</strong><p>${ic('check')}${label('web-playlist')} · ${state.saved.length}</p></span></button>
      ${state.collections.filter(collection => collection.name.toLowerCase().includes(filter.toLowerCase())).map(collection => `<button class="library-item ${state.collection === collection.id ? 'selected' : ''}" data-action="collection" data-id="${esc(collection.id)}" title="${esc(collection.name)}"><span class="library-art">${artwork(collection.tracks[0])}</span><span class="library-info"><strong>${esc(collection.name)}</strong><p>${label('web-playlist')} · ${collection.tracks.length}</p></span></button>`).join('')}
    </div><div class="library-bottom"><p>${label('web-privacy')}</p><p><a href="#about" data-action="about">${label('web-owners')}</a></p></div>`;
}
function offlineBanner() {
  if (state.hosted) {
    return state.catalogAvailable || state.browserAccount ? '' : `<div class="offline-banner"><div><strong>${label('web-offline')}</strong><p>${label(state.googleEnabled ? 'web-google-search-offline' : 'web-hosted-key-required')}</p></div>${state.googleEnabled ? '<button class="solid" data-action="settings">' + label('web-sign-in') + '</button>' : ''}</div>`;
  }
  return `<div class="offline-banner" ${state.connected || state.browserAccount ? 'hidden' : ''}><div class="offline-message">${ic('monitor-speaker')}<div><strong>${label('web-offline')}</strong><p>${label(state.googleEnabled ? 'web-google-search-offline' : 'web-offline-detail')}</p></div></div>${state.googleEnabled ? '<button class="solid" data-action="settings">' + label('web-sign-in') + '</button>' : '<button class="solid" data-action="open-desktop">' + label('web-open-desktop') + '</button>'}</div>`;
}
function card(track) {
  const key = trackKey(track);
  return `<article class="music-card"><button class="icon-btn card-menu" data-action="track-menu" data-key="${esc(key)}" aria-label="${label('web-more')}">${ic('more-horizontal')}</button><button class="cover-wrap" data-action="play-track" data-key="${esc(key)}" aria-label="${label('web-play')} ${esc(track.title)}" style="width:100%;padding:0;display:block">${artwork(track)}<span class="card-play">${ic('play')}</span></button><button class="card-title" data-action="play-track" data-key="${esc(key)}" title="${esc(track.title)}">${esc(track.title)}</button><p class="card-by">${esc(track.artists || track.album || t('web-youtube'))}</p></article>`;
}
function pagerButton(action, dir, disabled, key = '') {
  return `<button class="pager-btn" data-action="${action}" data-dir="${dir}"${key ? ` data-key="${esc(key)}"` : ''}${disabled ? ' disabled' : ''} aria-label="${label(dir < 0 ? 'web-previous' : 'web-next')}">${ic(dir < 0 ? 'chevron-left' : 'chevron-right')}</button>`;
}
function shelf(key, items) {
  if (!items?.length) return '';
  return `<section class="shelf" data-shelf="${esc(key)}"><div class="section-head"><h2>${label(key)}</h2><div class="pager">${pagerButton('shelf-scroll', -1, false, key)}${pagerButton('shelf-scroll', 1, false, key)}</div></div><div class="shelf-track">${items.map(card).join('')}</div></section>`;
}
function pick(track) {
  const key = trackKey(track);
  return `<button class="pick-tile" data-action="play-track" data-key="${esc(key)}"><span class="pick-art">${artwork(track)}</span><span class="pick-meta"><strong>${esc(track.title)}</strong><span>${label('web-song')} · ${esc(track.artists || t('web-youtube'))}</span></span></button>`;
}
/** The one deck on the page, like the desktop home: eight picks a page. */
function picksShelf(items) {
  const perPage = 8;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.min(state.picksPage, pages - 1);
  const shown = items.slice(page * perPage, page * perPage + perPage);
  return `<section class="picks-section"><div class="section-head"><h2>${label('web-quick-picks')}</h2><div class="pager">${pagerButton('picks-page', -1, page === 0)}${pagerButton('picks-page', 1, page >= pages - 1)}</div></div><div class="picks-grid">${shown.map(pick).join('')}</div></section>`;
}
function skeletons() { return `<div aria-label="${label('web-loading')}" aria-busy="true">${[1, 2].map(() => '<div class="skeleton skeleton-line"></div><div class="skeleton-grid">' + Array.from({ length: 5 }, () => '<div class="skeleton skeleton-card"></div>').join('') + '</div>').join('')}</div>`; }
function renderPage() {
  const node = document.querySelector('#main'); if (!node) return;
  let content = '';
  const tabs = `<nav class="page-tabs" aria-label="${label('web-music')}">${[['all', 'web-all'], ['song', 'web-songs'], ['album', 'web-albums'], ['playlist', 'web-playlists']].map(([filter, key]) => `<button class="pill ${state.filter === filter ? 'selected' : ''}" data-action="filter" data-id="${filter}" aria-pressed="${state.filter === filter}">${label(key)}</button>`).join('')}</nav>`;
  if (state.page === 'home') {
    const seeds = [...state.queue.previous.slice(0, 8), ...state.queue.upcoming, ...state.home.flatMap(section => section.items)];
    const seen = new Set();
    const picks = seeds.filter(track => {
      const key = track.id || track.link;
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const filteredPicks = state.filter === 'all' || state.filter === 'song' ? picks.filter(item => item.kind === 'song') : [];
    const sections = state.home.map(section => ({
      ...section,
      items: section.items.filter(item => state.filter === 'all' || item.kind === state.filter),
    })).filter(section => section.items.length);
    content = tabs + offlineBanner();
    if (state.loading) content += skeletons();
    else {
      if (filteredPicks.length) content += picksShelf(filteredPicks);
      content += sections.map(section => shelf(section.key, section.items)).join('');
      if (!filteredPicks.length && !sections.length) content += `<div class="catalog-empty" ${state.connected || state.catalogAvailable || state.browserAccount ? '' : 'hidden'}>${empty('web-catalog-empty', 'web-home-empty-detail', 'search')}</div>`;
    }
  } else if (state.page === 'settings') {
    content = renderSettings();
  } else if (state.page === 'search') {
    const searchTabs = [['', 'web-all'], ['song', 'web-songs'], ['album', 'web-albums'], ['artist', 'web-artists'], ['playlist', 'web-playlists']];
    content = (state.browserAccount || state.hosted ? '' : `<nav class="page-tabs">${searchTabs.map(([kind, key]) => `<button class="pill ${state.searchKind === kind ? 'selected' : ''}" data-action="search-kind" data-id="${kind}">${label(key)}</button>`).join('')}</nav>`) + offlineBanner();
    if (!state.query) content += empty('web-discover', 'web-search-detail', 'search');
    else if (state.searching) content += `<h2 class="search-title">${label('web-searching')}</h2>` + skeletons();
    else if (state.searchFailed) content += empty('web-request-failed', 'web-google-search-failed', 'search');
    else if (!state.hits.length) content += empty('web-no-results', 'web-no-results-detail', 'search');
    else content += `<h1 class="search-title">${label('web-results')} <span class="quiet">· ${esc(state.query)}</span></h1><div class="results-grid">${state.hits.map(card).join('')}</div>`;
  } else if (state.page === 'recents') {
    const tracks = state.queue.previous;
    content = `<h1 class="search-title">${label('web-recently-played')}</h1>` + (tracks.length ? trackList(tracks) : empty('web-recent-empty', 'web-search-detail', 'disc-3'));
  } else if (state.page === 'shelf') {
    const section = state.home.find(item => item.key === state.collection) || { key: state.collection, items: state.queue.upcoming };
    content = `<h1 class="search-title">${label(section.key)}</h1><div class="results-grid">${section.items.map(card).join('')}</div>`;
  } else {
    const liked = state.page === 'liked';
    const collection = state.collections.find(item => item.id === state.collection);
    const tracks = liked ? state.saved : collection?.tracks || [];
    content = `<div class="collection-hero"><div class="collection-cover ${liked ? 'liked-art' : ''}">${liked ? ic('heart-filled') : artwork(tracks[0])}</div><div><small>${label('web-playlist')}</small><h1>${liked ? label('web-liked') : esc(collection?.name || t('web-playlists'))}</h1><p>${label('web-saved')} · ${tracks.length}</p></div></div><div class="collection-actions"><button class="big-play" data-action="play-collection" aria-label="${label('web-play')}" ${tracks.length ? '' : 'disabled'}>${ic('play')}</button></div>`;
    content += tracks.length ? trackList(tracks) : empty(liked ? 'web-liked-empty' : 'web-collection-empty', liked ? 'web-liked-detail' : 'web-collection-empty-detail', 'heart');
  }
  node.innerHTML = `<div class="page${state.page === 'home' ? ' home-page' : ''}">${content}</div>`;
  if (state.page === 'settings') updateProviderStatus();
  updatePhoneNav();
}
function trackList(tracks) {
  return `<div class="track-list">${tracks.map((track, index) => row(track, index)).join('')}</div>`;
}
function row(track, index) {
  const key = trackKey(track), playing = track.id && track.id === state.current?.track?.id;
  return `<div class="track-row ${playing ? 'playing' : ''}"><button class="row-art" data-action="play-track" data-key="${esc(key)}" aria-label="${label('web-play')} ${esc(track.title)}">${artwork(track)}</button><button class="row-meta" data-action="play-track" data-key="${esc(key)}"><span class="row-title">${esc(track.title)}</span><span class="row-artists">${esc(track.artists)}</span></button><span class="row-duration">${track.duration ? clock(track.duration) : ''}</span><button class="icon-btn row-actions" data-action="track-menu" data-key="${esc(key)}" aria-label="${label('web-more')}">${ic('more-horizontal')}</button></div>`;
}
function renderRight() {
  const node = document.querySelector('#right'); if (!node) return;
  const track = currentTrack();
  let header, body;
  if (state.pane === 'queue' || state.pane === 'recent') {
    header = `<div class="right-tabs"><button class="right-tab ${state.pane === 'queue' ? 'selected' : ''}" data-action="pane" data-id="queue">${label('web-queue')}</button><button class="right-tab ${state.pane === 'recent' ? 'selected' : ''}" data-action="pane" data-id="recent">${label('web-recently-played')}</button></div>`;
    const previous = state.queue.previous;
    body = state.pane === 'recent' ? (previous.length ? trackList(previous) : empty('web-recent-empty', 'web-search-detail')) :
      `${track ? `<div class="right-section"><h3>${label('web-now-playing')}</h3></div>${row(track, 0)}` : ''}<div class="right-section"><h3>${label('web-next-up')}</h3><span class="quiet">${state.queue.upcoming.length}</span></div>${state.queue.upcoming.length ? trackList(state.queue.upcoming) : empty('web-queue-empty', 'web-queue-detail', 'list-music')}`;
  } else if (state.pane === 'connect') {
    header = `<strong>${label('web-connect')}</strong>`;
    body = `<section class="output-card"><div class="output-title">${ic('monitor-speaker')}<span>${label('web-this-computer')}</span></div><p>${label('web-connected-output')}</p><p>${label('web-output-detail')}</p><button class="solid" data-action="open-desktop">${label('web-manage-output')}</button></section>`;
  } else if (state.pane === 'lyrics') {
    header = `<strong>${label('web-lyrics')}</strong>`;
    body = state.lyrics?.lines?.length ? `<div class="lyrics-full">${state.lyrics.lines.map(line => `<p class="lyrics-line ${line.start_ms === state.lyrics.current?.start_ms ? 'active' : ''}" ${line.start_ms != null ? `data-action="lyric-seek" data-time="${line.start_ms / 1000}" tabindex="0" role="button"` : ''}>${esc(line.text)}</p>`).join('')}</div>` : empty('web-lyrics', state.lyrics?.state === 'loading' ? 'web-lyrics-loading' : 'web-no-lyrics', 'mic-vocal');
  } else {
    header = `<strong>${esc(state.current?.origin?.name || t('web-now-playing'))}</strong>`;
    body = track ? `<div class="now-cover">${artwork(track)}</div><div class="now-info"><div class="now-line"><div><h2>${esc(track.title)}</h2><p>${esc(track.artists)}</p></div><button class="icon-btn player-like ${state.current?.liked ? 'active' : ''}" data-action="like" aria-label="${label(state.current?.liked ? 'web-unlike' : 'web-like')}">${ic(state.current?.liked ? 'heart-filled' : 'heart')}</button></div></div><div class="lyrics-preview"><h3>${label('web-lyrics-preview')}</h3><p>${esc(state.lyrics?.current?.text || state.lyrics?.lines?.[0]?.text || t('web-no-lyrics'))}</p><button class="pill" data-action="pane" data-id="lyrics">${label('web-show-lyrics')}</button></div><div class="right-section"><h3>${label('web-next-up')}</h3><button class="quiet" data-action="pane" data-id="queue">${label('web-queue')}</button></div>${state.queue.upcoming.slice(0, 3).map(row).join('')}` : empty('web-player-idle', 'web-player-idle-detail', 'disc-3');
  }
  node.innerHTML = `<header class="right-head">${header}${button('close-right', 'x', 'web-close')}</header><div class="right-body">${body}</div>`;
}
function renderPlayer() {
  const node = document.querySelector('#player'); if (!node) return;
  const current = state.current, track = currentTrack(), playing = current?.state === 'playing';
  const duration = local.duration || track?.duration || 0, position = current?.position || 0;
  const muted = local.muted || local.volume === 0;
  const tools = [['queue', 'list-music', 'web-queue'], ['connect', 'monitor-speaker', 'web-connect']];
  if (preferences.lyrics) tools.unshift(['lyrics', 'mic-vocal', 'web-lyrics']);
  node.innerHTML = `<div class="playing-track"><button class="player-art" data-action="pane" data-id="now" aria-label="${label('web-now-view')}">${track ? artwork(track) : '<img src="/assets/logo.svg" alt="">'}</button><div class="player-track-meta"><button class="player-title" data-action="pane" data-id="now">${esc(track?.title || t('web-player-idle'))}</button><p class="player-artists">${esc(track?.artists || t('web-player-idle-detail'))}</p></div><button class="icon-btn player-like ${current?.liked ? 'active' : ''}" data-action="like" title="${label(current?.liked ? 'web-unlike' : 'web-like')}" aria-label="${label(current?.liked ? 'web-unlike' : 'web-like')}" ${track ? '' : 'disabled'}>${ic(current?.liked ? 'heart-filled' : 'heart')}</button></div>
    <div class="player-mid"><div class="transport"><button class="icon-btn ${local.shuffle ? 'active' : ''}" data-action="shuffle" title="${label('web-shuffle')}" aria-label="${label('web-shuffle')}" aria-pressed="${Boolean(local.shuffle)}">${ic('shuffle')}</button>${button('previous', 'skip-back', 'web-previous')}<button class="play-toggle" data-action="toggle" title="${label(playing ? 'web-pause' : 'web-play')}" aria-label="${label(playing ? 'web-pause' : 'web-play')}" ${track ? '' : 'disabled'}>${current?.state === 'loading' ? '<span class="spinner"></span>' : ic(playing ? 'pause' : 'play')}</button>${button('next', 'skip-forward', 'web-next')}<button class="icon-btn ${local.repeat !== 'off' ? 'active' : ''}" data-action="repeat" title="${label('web-repeat')}" aria-label="${label('web-repeat')}">${ic('repeat')}${local.repeat === 'one' ? '<small>1</small>' : ''}</button></div><div class="progress"><span class="clock" id="elapsed">${clock(position)}</span><input class="range" type="range" id="seek" min="0" max="${duration || 1}" value="${position}" step="1" style="--progress:${duration ? position / duration * 100 : 0}%" aria-label="${label('web-seek')}" ${duration ? '' : 'disabled'}><span class="clock" id="total">${endClock(duration, position)}</span></div></div>
    <div class="player-tools">${tools.map(([pane, icon, key]) => `<button class="icon-btn ${state.right && state.pane === pane ? 'active' : ''}" data-action="pane-toggle" data-id="${pane}" title="${label(key)}" aria-label="${label(key)}" aria-expanded="${state.right && state.pane === pane}">${ic(icon)}</button>`).join('')}${button('mute', muted ? 'volume-x' : 'volume-2', muted ? 'web-unmute' : 'web-mute')}<input id="volume" type="range" min="0" max="100" value="${local.volume}" class="range volume-range" style="--progress:${local.volume}%" aria-label="${label('web-volume')}">${button('now-pane', 'monitor-speaker', 'web-now-view')}${button('fullscreen', 'maximize', 'web-fullscreen')}</div>`;
  node.querySelector('.player-tools')?.insertAdjacentHTML('afterbegin',
    `<button class="icon-btn ${listening.room ? 'active' : ''}" data-action="session-menu" aria-label="${label('web-sessions')}" title="${label('web-sessions')}">${ic('users-round-collaboration')}</button>`);
}
/// The mini player shows only what fits in a picture-in-picture square.
function renderPip() {
  const node = document.querySelector('#pip-card'); if (!node) return;
  const track = currentTrack(), playing = state.current?.state === 'playing';
  node.innerHTML = `<div class="pip-art">${track ? artwork(track) : '<img src="/assets/logo.svg" alt="">'}</div><div class="pip-copy"><strong>${esc(track?.title || t('web-player-idle'))}</strong><span>${esc(track?.artists || t('web-player-idle-detail'))}</span></div><button class="pip-toggle" data-action="toggle" aria-label="${label(playing ? 'web-pause' : 'web-play')}" ${track ? '' : 'disabled'}>${ic(playing ? 'pause' : 'play')}</button>`;
}
function updateProgress(sample = true) {
  if (!state.current) return;
  if (sample && local.loaded && player.ready && local.state !== 'loading' && performance.now() >= local.seekUntil) {
    const time = player.time();
    if (time != null) { local.position = time; state.current.position = time; }
    const length = player.duration();
    if (length) local.duration = length;
  }
  const duration = local.duration || state.current.track.duration || 0;
  const position = duration ? Math.min(duration, Math.max(0, local.position)) : Math.max(0, local.position);
  const seek = document.querySelector('#seek');
  if (seek && !seek.matches(':active') && document.activeElement !== seek) {
    seek.max = duration || 1; seek.disabled = !duration;
    seek.value = position; seek.style.setProperty('--progress', `${duration ? position / duration * 100 : 0}%`);
    const elapsed = document.querySelector('#elapsed'); if (elapsed) elapsed.textContent = clock(position);
    const total = document.querySelector('#total'); if (total) total.textContent = endClock(duration, position);
  }
  syncLyric(position);
  checkpointPlayback();
}
function syncLyric(position) {
  const lines = state.lyrics?.lines;
  if (!lines?.length) return;
  const at = position * 1000;
  let current = null;
  for (const line of lines) { if (line.start_ms <= at) current = line; else break; }
  if (current?.start_ms === state.lyrics.current?.start_ms) return;
  state.lyrics.current = current;
  if (!state.right) return;
  if (state.pane === 'lyrics') {
    for (const node of document.querySelectorAll('#right .lyrics-line')) {
      node.classList.toggle('active', Number(node.dataset.time) * 1000 === current?.start_ms);
    }
  } else if (state.pane === 'now') {
    const preview = document.querySelector('#right .lyrics-preview p');
    if (preview) preview.textContent = current?.text || lines[0]?.text || '';
  }
}
function refreshQueue() {
  state.queue = { previous: local.history.slice(), current: localTrack(), upcoming: local.queue.slice(local.index + 1) };
  if (state.right) renderRight();
  if (state.page === 'recents') renderPage();
}
async function refreshLyrics() {
  const track = preferences.lyrics ? localTrack() : null;
  refreshLyrics.wanted = track?.id || null;
  if (!track) { state.lyrics = null; if (state.right) renderRight(); return; }
  const serial = refreshLyrics.wanted;
  try {
    const value = await api(`web-lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artists || '')}&duration=${Math.round(Number(track.duration) || 0)}`);
    if (refreshLyrics.wanted !== serial) return;
    state.lyrics = value?.lines?.length ? value : null;
  } catch { if (refreshLyrics.wanted === serial) state.lyrics = null; }
  if (state.right && ['lyrics', 'now'].includes(state.pane)) renderRight();
}
function navigate(page, collection = null, remember = true) {
  if (remember) { state.history.push({ page: state.page, collection: state.collection }); state.forward = []; }
  state.page = page; state.collection = collection;
  renderLibrary(); renderPage(); document.querySelector('#main').scrollTop = 0;
  history.replaceState(null, '', `#${page}`);
  if (page === 'settings') refreshProviderStatus();
}
async function doSearch() {
  state.query = document.querySelector('#global-search')?.value.trim() || '';
  const serial = ++doSearch.serial;
  state.searchFailed = false;
  if (state.page !== 'search') navigate('search');
  if (!state.query) { state.hits = []; state.searching = false; renderPage(); return; }
  state.searching = true; renderPage();
  try {
    const hits = await api(`search?q=${encodeURIComponent(state.query)}&kind=${encodeURIComponent(state.searchKind)}`);
    if (serial !== doSearch.serial) return;
    state.hits = hits;
  } catch {
    if (serial === doSearch.serial) {
      state.hits = [];
      state.searchFailed = Boolean(state.browserAccount);
    }
  }
  if (serial === doSearch.serial) { state.searching = false; renderPage(); }
}
doSearch.serial = 0;
function closeOverlay() { overlays.innerHTML = ''; }
function modal(content, className = '') {
  overlays.innerHTML = `<div class="overlay-shade" data-action="dismiss-modal"><section class="modal ${className}" role="dialog" aria-modal="true" tabindex="-1">${content}</section></div>`;
  overlays.querySelector('.modal').focus();
}

function sessionDialog(mode = 'menu') {
  const room = listening.room;
  let content;
  if (room) {
    content = `<p>${label('web-session-share')}</p><p class="session-code">${esc(room.code)}</p><ul class="session-members">${room.members.map(member => `<li>${esc(member.name)}${member.host ? ' · ' + label('web-session-host') : ''}</li>`).join('')}</ul><button class="pill" data-action="session-leave">${label('web-session-leave')}</button>`;
  } else if (pendingRoom) {
    content = `<p role="status">${label('web-session-connecting')}</p>`;
  } else if (mode === 'start' || mode === 'join') {
    const joining = mode === 'join';
    const codeInput = joining ? `<label for="session-code">${label('web-session-code')}</label><input id="session-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required>` : '';
    content = `<form class="create-form" id="session-form" data-mode="${mode}"><label for="session-name">${label('web-session-name')}</label><input id="session-name" name="name" maxlength="40" required value="${label('web-session-listener')}">${codeInput}<div class="form-actions"><button class="solid" type="submit">${label(joining ? 'web-session-join' : 'web-session-start')}</button></div></form>`;
  } else {
    content = `<div class="session-actions"><button class="pill" data-action="session-start">${label('web-session-start')}</button><button class="pill" data-action="session-join">${label('web-session-join')}</button></div>`;
  }
  modal(`<div class="modal-head"><h2>${label('web-sessions')}</h2>${button('close-overlay', 'x', 'web-close')}</div>${content}`, 'session-modal');
}

function installDialog() {
  modal(`<div class="modal-head"><h2>${label('web-install-app')}</h2>${button('close-overlay', 'x', 'web-close')}</div><div class="session-actions"><a class="solid" href="/downloads/NovaXCloudMusic-SetupV3.exe" download>${label('web-download-windows')}</a><a class="pill" href="/downloads/NovaXCloudMusic.apk" download>${label('web-download-android')}</a></div>`);
}
function showAbout() {
  modal(`<div class="modal-head"><div class="modal-brand" style="margin:0"><img src="/assets/logo.svg" alt=""><div><h2>${label('web-brand-name')}</h2><small>${label('web-no-updates')}</small></div></div>${button('close-overlay', 'x', 'web-close')}</div><h3 class="modal-section-title">${label('music-owners-title')}</h3>${[['divyang','music-owner-divyang','1421764734809542738'],['rahul','music-owner-rahul','1532758800657027083']].map(([image, name, id]) => `<div class="owner-row"><img src="/assets/${image}.png" alt=""><div><strong>${label(name)}</strong><p>${label('music-owner-role')}</p></div><a class="pill" href="https://discord.com/users/${id}" target="_blank" rel="noopener noreferrer">${label('music-owner-message')}</a></div>`).join('')}<h3 class="modal-section-title">${label('music-community-title')}</h3><div class="community-card"><img src="/assets/community.png" alt=""><div><strong>${label('music-community-name')}</strong><p>${label('music-community-detail')}</p></div><a class="solid green" href="https://discord.gg/nbtRKNvY57" target="_blank" rel="noopener noreferrer">${label('music-community-join')}</a></div><p class="modal-footer">${label('web-privacy')}</p>`);
}
function showAccount() {
  const anchor = document.querySelector('.profile-btn').getBoundingClientRect();
  popover(`<button data-action="account-detail">${ic('circle-user-round')}${label('web-account')}</button><button data-action="recents">${ic('list-music')}${label('web-recently-played')}</button><button data-action="settings">${ic('settings')}${label('web-settings')}</button><hr><button data-action="about">${ic('users-round-collaboration')}${label('web-owners')}</button><a href="https://discord.gg/nbtRKNvY57" target="_blank" rel="noopener noreferrer">${ic('external-link')}${label('web-support')}</a>`, anchor.right - 250, anchor.bottom + 8);
}
/** Apply browser preferences without modifying the desktop player's settings. */
function applyPreferences() {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme === 'light' || (preferences.theme === 'system' && systemTheme.matches) ? 'light' : 'dark';
  root.classList.toggle('reduce-motion', preferences.motion);
  root.classList.toggle('centered-pages', preferences.centered);
  root.classList.toggle('hide-lyrics', !preferences.lyrics);
}

function updateProviderStatus() {
  const status = document.querySelector('#provider-status');
  if (!status) return;
  if (state.browserAccount) {
    status.textContent = state.browserAccount.name || t('web-google-signed-in');
    return;
  }
  if (state.googleEnabled) {
    status.textContent = t('web-google-signed-out');
    return;
  }
  const key = !state.connected ? 'web-offline'
    : !providerStatus ? 'web-provider-checking'
      : providerStatus.unavailable ? 'web-provider-unavailable'
      : providerStatus.current ? 'web-provider-active'
        : providerStatus.stored ? 'web-provider-saved' : 'web-provider-setup';
  status.textContent = t(key);
}

async function refreshProviderStatus() {
  if (state.googleEnabled || state.hosted) return;
  try {
    providerStatus = await api('provider-status');
  } catch {
    providerStatus = { unavailable: true };
  }
  updateProviderStatus();
}

function openSettings(tab = 'general') {
  settingsTab = tab;
  if (state.page !== 'settings') navigate('settings');
  else {
    renderPage();
    if (tab === 'general') refreshProviderStatus();
  }
  document.querySelector('#main').scrollTop = 0;
}

function updatePlaybackSetting(key, value) {
  const control = document.querySelector(`[data-preference="${key}"]`);
  if (!control) return;
  if (control.type === 'checkbox') control.checked = value;
  else control.value = value;
}

const settingAction = (action, key, id = '') => `<button class="pill" data-action="${action}"${id ? ` data-id="${id}"` : ''}>${label(key)}</button>`;
const settingRow = (title, detail, control) => `<div class="setting-row"><div><strong>${label(title)}</strong><p>${label(detail)}</p></div>${control}</div>`;
const settingToggle = (key, title, checked) => `<input type="checkbox" role="switch" class="setting-switch" data-preference="${key}" aria-label="${label(title)}"${checked ? ' checked' : ''}>`;
const settingSelect = (key, title, options, current) => `<select data-preference="${key}" aria-label="${label(title)}">${options.map(([value, text]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label(text)}</option>`).join('')}</select>`;

/** Draw a section of settings using browser controls or a link to the matching desktop screen. */
function settingsSection(section) {
  let body;
  switch (section) {
    case 'providers':
      const browserAction = state.browserAccount
        ? settingAction('sign-out-google', 'web-google-sign-out')
        : state.googleEnabled
          ? `<a class="solid" href="/api/google/start">${label('web-sign-in')}</a>`
          : `<button class="solid" disabled>${label('web-sign-in')}</button>`;
      body = `<p class="settings-group-label">${label('web-streaming-services')}</p><article class="provider-card"><div class="provider-mark">${ic('disc-3')}</div><div class="provider-summary"><h3>${label('web-youtube')}</h3><p id="provider-status" role="status"></p></div><div class="provider-actions">${browserAction}</div></article><p class="settings-provider-note">${label(state.googleEnabled ? 'web-google-sign-in-detail' : 'web-google-setup')}</p>`
        + (state.hosted ? '' : settingRow('web-guest-mode', window.Native ? 'web-phone-account' : 'web-provider-detail', settingAction('open-desktop-account', 'web-open-desktop')));
      break;
    case 'general':
      body = settingRow('web-setting-desktop', 'web-setting-desktop-detail', settingAction('open-desktop-settings', 'web-open-desktop-settings'));
      if (window.Native) {
        body += settingRow('web-phone-app', 'web-phone-background', `<div class="setting-actions">${settingAction('phone-notifications', 'web-phone-notifications')}${settingAction('phone-connect', 'web-phone-change')}</div>`);
      }
      break;
    case 'appearance':
      body = settingRow('web-setting-theme', 'web-setting-theme-detail', settingSelect('theme', 'web-setting-theme', [['system', 'web-theme-system'], ['dark', 'web-theme-dark'], ['light', 'web-theme-light']], preferences.theme))
        + settingRow('web-setting-motion', 'web-setting-motion-detail', settingToggle('motion', 'web-setting-motion', preferences.motion))
        + settingRow('web-setting-centered', 'web-setting-centered-detail', settingToggle('centered', 'web-setting-centered', preferences.centered));
      break;
    case 'player-bar':
      body = settingRow('web-setting-remaining', 'web-setting-remaining-detail', settingToggle('remaining', 'web-setting-remaining', preferences.remaining));
      break;
    case 'now-playing':
      body = settingRow('web-now-playing', 'web-setting-now-detail', settingAction('now-pane', 'web-now-view'));
      break;
    case 'playback':
      body = settingRow('web-shuffle', 'web-setting-shuffle-detail', settingToggle('shuffle', 'web-shuffle', local.shuffle))
        + settingRow('web-repeat', 'web-setting-repeat-detail', settingSelect('repeat', 'web-repeat', [['off', 'web-repeat-off'], ['all', 'web-repeat-all'], ['one', 'web-repeat-one']], local.repeat));
      break;
    case 'sound':
      body = settingRow('web-volume', 'web-setting-volume-detail', `<input class="setting-volume" type="range" min="0" max="100" value="${local.volume}" data-preference="volume" aria-label="${label('web-volume')}">`)
        + settingRow('web-connect', 'web-output-detail', settingAction('connect-settings', 'web-setting-output'));
      break;
    case 'lyrics':
      body = settingRow('web-show-lyrics', 'web-setting-lyrics-detail', settingToggle('lyrics', 'web-show-lyrics', preferences.lyrics));
      break;
    case 'storage':
      body = settingRow('web-library', 'web-setting-storage-detail', settingAction('collections', 'web-playlists'))
        + settingRow('web-setting-downloads', 'web-setting-downloads-detail', settingAction('open-desktop-storage', 'web-open-desktop-settings'));
      break;
    case 'integrations':
      body = settingRow('web-setting-integrations', 'web-setting-integrations-detail', `<div class="setting-actions">${settingAction('open-desktop-discord', 'web-setting-discord')}${settingAction('open-desktop-scrobbling', 'web-setting-scrobbling')}</div>`);
      break;
    case 'about':
      body = settingRow('web-brand-name', 'web-privacy', settingAction('about', 'web-owners'));
      break;
    case 'keybinds':
      body = settingRow('web-setting-shortcuts', 'web-shortcuts', '');
      break;
  }
  return `<section class="settings-section" aria-labelledby="setting-${section}"><h2 id="setting-${section}">${label(`web-settings-${section}`)}</h2>${body}</section>`;
}

function renderSettings() {
  return `<div class="settings-layout"><header class="settings-header"><h1 class="sr-only">${label('web-settings')}</h1><label class="settings-search">${ic('search')}<input type="search" id="settings-search" placeholder="${label('web-settings-search')}" aria-label="${label('web-settings-search')}"></label><nav class="settings-navigation" aria-label="${label('web-settings')}">${Object.entries(settingsGroups).map(([tab, {icon}]) => `<button data-action="settings-tab" data-id="${tab}"${settingsTab === tab ? ' aria-current="true"' : ''}>${ic(icon)}${label(`web-settings-${tab}`)}</button>`).join('')}</nav></header><div class="settings-content">${settingsGroups[settingsTab].sections.map(settingsSection).join('')}</div></div>`;
}

function filterSettings(query) {
  const content = document.querySelector('.settings-content');
  const search = query.trim().toLocaleLowerCase();
  const sections = search ? Object.values(settingsGroups).flatMap(group => group.sections) : settingsGroups[settingsTab].sections;
  content.innerHTML = sections.map(settingsSection).join('');
  updateProviderStatus();
  document.querySelector('.settings-navigation').classList.toggle('is-searching', Boolean(search));
  if (!search) return;
  for (const section of content.children) {
    section.hidden = !section.textContent.toLocaleLowerCase().includes(search);
  }
  if ([...content.children].every(section => section.hidden)) content.innerHTML = empty('web-no-results', 'web-settings-search-detail', 'search');
}
function popover(content, x, y) {
  overlays.innerHTML = `<div class="popover" role="menu" style="left:${Math.max(8, Math.min(x, innerWidth - 260))}px;top:${Math.max(8, Math.min(y, innerHeight - 310))}px">${content}</div>`;
}
function trackMenu(track, target) {
  const key = trackKey(track), box = target.getBoundingClientRect();
  popover(`<button data-action="queue-track" data-key="${esc(key)}">${ic('plus')}${label('web-add-queue')}</button><button data-action="next-track" data-key="${esc(key)}">${ic('skip-forward')}${label('web-play-next')}</button><button data-action="save-track" data-key="${esc(key)}">${ic('list-music')}${label('web-add-playlist')}</button><hr><button data-action="copy-track" data-key="${esc(key)}">${ic('link')}${label('web-copy-link')}</button><a href="${esc(track.link)}" target="_blank" rel="noopener noreferrer">${ic('external-link')}${label('web-open-youtube')}</a>`, box.left - 200, box.bottom + 5);
}
function createPlaylist() {
  modal(`<div class="modal-head"><h2>${label('web-create-title')}</h2>${button('close-overlay', 'x', 'web-close')}</div><p>${label('web-create-detail')}</p><form id="create-form" class="create-form"><label for="playlist-name">${label('web-create-name')}</label><input id="playlist-name" required maxlength="80" placeholder="${label('web-create-placeholder')}" autocomplete="off"><div class="form-actions"><button type="button" class="pill" data-action="close-overlay">${label('web-cancel')}</button><button class="solid green" type="submit">${label('web-create')}</button></div></form>`);
  document.querySelector('#playlist-name').focus();
}
function saveToCollection(track) {
  if (!state.collections.length) { createPlaylist(); createPlaylist.pendingTrack = track; return; }
  modal(`<div class="modal-head"><h2>${label('web-select-playlist')}</h2>${button('close-overlay', 'x', 'web-close')}</div>${state.collections.map(collection => `<button class="library-item" data-action="put-collection" data-id="${esc(collection.id)}" data-key="${esc(trackKey(track))}"><span class="library-art">${artwork(collection.tracks[0])}</span><strong>${esc(collection.name)}</strong></button>`).join('')}<button class="pill" data-action="create" style="margin-top:18px">${label('web-create')}</button>`);
}

document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
  img.dataset.failed = 'true';
  const letter = document.createElement('span');
  letter.className = 'art-fallback';
  letter.textContent = (img.dataset.letter || 'N').slice(0, 1);
  img.replaceWith(letter);
}, true);
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) { if (!event.target.closest('.popover,.modal')) closeOverlay(); return; }
  const { action, id, key } = target.dataset;
  if (action === 'home' && target.matches('a')) event.preventDefault();
  const track = key ? state.tracks.get(key) : null;
  if (action === 'dismiss-modal') { if (event.target === target) closeOverlay(); return; }
  if (!['account', 'track-menu', 'put-collection'].includes(action) && !event.target.closest('.modal')) closeOverlay();
  if (action === 'reload') location.reload();
  else if (action === 'install-app') installDialog();
  else if (action === 'session-menu') sessionDialog();
  else if (action === 'session-start') sessionDialog('start');
  else if (action === 'session-join') sessionDialog('join');
  else if (action === 'session-leave') listening.leave();
  else if (action === 'home') { phoneLibrary(false); navigate('home'); }
  else if (action === 'refresh-page') {
    if (state.page === 'home') loadHome();
    else if (state.page === 'search') doSearch();
    else if (state.page === 'settings') refreshProviderStatus();
    else renderPage();
  }
  else if (action === 'phone-search') { phoneLibrary(false); navigate('search'); document.querySelector('#global-search').focus(); }
  else if (action === 'phone-library') phoneLibrary(!document.querySelector('.app-shell')?.classList.contains('phone-library'));
  else if (action === 'close-library') phoneLibrary(false);
  else if (action === 'back' || action === 'forward') {
    const from = action === 'back' ? state.history : state.forward, to = action === 'back' ? state.forward : state.history;
    const next = from.pop(); if (next) { to.push({ page: state.page, collection: state.collection }); navigate(next.page, next.collection, false); }
  }
  else if (action === 'focus-search') document.querySelector('#global-search').focus();
  else if (action === 'liked') { phoneLibrary(false); navigate('liked'); }
  else if (action === 'recents') { phoneLibrary(false); await refreshQueue(); navigate('recents'); }
  else if (action === 'collection') { phoneLibrary(false); navigate('collection', id); }
  else if (action === 'collections') { phoneLibrary(false); if (state.collections.length) navigate('collection', state.collections[0].id); else createPlaylist(); }
  else if (action === 'create') createPlaylist();
  else if (action === 'collapse') {
    if (matchMedia('(max-width:600px)').matches) { phoneLibrary(false); return; }
    state.collapsed = !state.collapsed; updateLayout(); saveLayout();
  }
  else if (action === 'library-search') { const sort = document.querySelector('.library-sort'); sort.classList.toggle('searching'); if (sort.classList.contains('searching')) document.querySelector('#library-query').focus(); }
  else if (action === 'filter') {
    state.filter = id; state.picksPage = 0; renderPage();
    document.querySelector('.page-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  else if (action === 'search-kind') { state.searchKind = id; doSearch(); }
  else if (action === 'show-shelf') navigate('shelf', key);
  else if (action === 'picks-page') { state.picksPage = Math.max(0, state.picksPage + Number(target.dataset.dir)); renderPage(); }
  else if (action === 'shelf-scroll') {
    const track = target.closest('.shelf')?.querySelector('.shelf-track');
    if (track) track.scrollBy({ left: Number(target.dataset.dir) * Math.max(240, track.clientWidth * 0.8), behavior: 'smooth' });
  }
  else if (action === 'play-track' && track) playOrSearch(target, key);
  else if (action === 'queue-track' && track) act('queue-item', { link: track.link });
  else if (action === 'next-track' && track) act('next-item', { link: track.link });
  else if (action === 'track-menu' && track) trackMenu(track, target);
  else if (action === 'save-track' && track) saveToCollection(track);
  else if (action === 'copy-track' && track) { try { await navigator.clipboard.writeText(track.link); toast('web-link-copied'); } catch { toast('web-request-failed'); } }
  else if (action === 'put-collection' && track) {
    const collection = state.collections.find(item => item.id === id);
    if (collection && !collection.tracks.some(item => item.link === track.link)) collection.tracks.push(track);
    localStorage.setItem('novax-collections', JSON.stringify(state.collections)); closeOverlay(); renderLibrary(); toast('web-added-playlist');
  }
  else if (action === 'play-collection') {
    const tracks = state.page === 'liked' ? state.saved : state.collections.find(item => item.id === state.collection)?.tracks || [];
    if (tracks.length) act('play-item', { links: tracks.map(item => item.link) });
  }
  else if (action === 'pane' || action === 'pane-toggle') {
    state.right = action === 'pane-toggle' && state.right && state.pane === id ? false : true; state.pane = id;
    renderRight(); renderPlayer(); updateLayout(); saveLayout(); if (id === 'lyrics') refreshLyrics(); if (id === 'queue' || id === 'recent') refreshQueue();
  }
  else if (action === 'now-pane') { state.right = true; state.pane = 'now'; renderRight(); renderPlayer(); updateLayout(); saveLayout(); }
  else if (action === 'toggle-right') {
    state.right = !state.right; renderRight(); renderPlayer(); updateLayout(); saveLayout();
  }
  else if (action === 'close-right') { state.right = false; updateLayout(); saveLayout(); renderPlayer(); }
  else if (action === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  else if (action === 'about') showAbout();
  else if (action === 'account') showAccount();
  else if (action === 'account-detail' || action === 'settings') openSettings();
  else if (action === 'settings-tab' && Object.hasOwn(settingsGroups, id)) {
    openSettings(id);
    document.querySelector('.settings-navigation [aria-current]')?.focus({ preventScroll: true });
  }
  else if (action === 'close-overlay') closeOverlay();
  else if (action === 'connect-settings') { closeOverlay(); state.right = true; state.pane = 'connect'; renderRight(); updateLayout(); saveLayout(); }
  else if (desktopActions.includes(action)) {
    target.disabled = true;
    try { await act(action); } finally { target.disabled = false; }
  }
  else if (action === 'sign-out-google') {
    target.disabled = true;
    try {
      await api('action', { action });
      state.browserAccount = null;
      state.hits = [];
      renderPage();
      updateConnection();
    } catch {
      toast('web-request-failed');
    } finally {
      target.disabled = false;
    }
  }
  else if (action === 'phone-connect') window.Native?.forget?.();
  else if (action === 'phone-notifications') window.Native?.requestNotifications?.();
  else if (action === 'lyric-seek') act('seek', { seconds: Number(target.dataset.time) });
  else if (action === 'repeat') act('repeat', { value: state.local.repeat === 'off' ? 'all' : state.local.repeat === 'all' ? 'one' : 'off' });
  else if (['toggle', 'next', 'previous', 'shuffle', 'mute', 'like'].includes(action)) act(action);
});
document.addEventListener('submit', event => {
  if (event.target.id === 'session-form') {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get('name')).trim();
    if (!name || pendingRoom) return;
    const joining = event.target.dataset.mode === 'join';
    const request = joining ? { type: 'join', code: form.get('code'), name, providers: ['youtube'] }
      : { type: 'create', name, provider: 'youtube' };
    try {
      pendingRoom = true;
      listening.connect(state.sessionUrl, request);
      sessionDialog();
    } catch {
      pendingRoom = false;
      toast('web-session-unavailable');
    }
  }
  if (event.target.id === 'search-form') { event.preventDefault(); clearTimeout(doSearch.timer); doSearch(); }
  if (event.target.id === 'create-form') {
    event.preventDefault(); const name = document.querySelector('#playlist-name').value.trim(); if (!name) return;
    const collection = { id: crypto.randomUUID(), name, tracks: createPlaylist.pendingTrack ? [createPlaylist.pendingTrack] : [] };
    createPlaylist.pendingTrack = null; state.collections.unshift(collection); localStorage.setItem('novax-collections', JSON.stringify(state.collections));
    closeOverlay(); navigate('collection', collection.id); toast('web-created');
  }
});
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'global-search') {
    clearTimeout(doSearch.timer);
    if ((!state.browserAccount && !state.hosted) || !input.value.trim()) doSearch.timer = setTimeout(doSearch, 300);
  }
  if (input.id === 'settings-search') filterSettings(input.value);
  if (input.id === 'library-query') {
    const filter = input.value; document.querySelectorAll('.library-item[data-id]').forEach(item => item.classList.toggle('hide', !state.collections.find(c => c.id === item.dataset.id)?.name.toLowerCase().includes(filter.toLowerCase())));
  }
  if (input.id === 'seek') { input.style.setProperty('--progress', `${input.value / input.max * 100}%`); document.querySelector('#elapsed').textContent = clock(input.value); }
  if (input.id === 'volume') input.style.setProperty('--progress', `${input.value}%`);
});
document.addEventListener('change', event => {
  const { preference } = event.target.dataset;
  if (preference === 'volume') act('volume', { value: Number(event.target.value) });
  else if (preference === 'shuffle' && local.shuffle !== event.target.checked) act('shuffle');
  else if (preference === 'repeat') act('repeat', { value: event.target.value });
  else if (Object.hasOwn(preferenceDefaults, preference)) {
    preferences[preference] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    localStorage.setItem('novax-web-preferences', JSON.stringify(preferences));
    applyPreferences();
    if (preference === 'remaining') {
      const total = document.querySelector('#total');
      if (total) total.textContent = endClock(local.duration || currentTrack()?.duration || 0, local.position);
    }
    if (preference === 'lyrics') {
      if (!preferences.lyrics && state.pane === 'lyrics') state.pane = 'now';
      renderPlayer();
      refreshLyrics();
    }
  }
  if (event.target.id === 'seek') act('seek', { seconds: Number(event.target.value) });
  if (event.target.id === 'volume') act('volume', { value: Number(event.target.value) });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeOverlay(); document.querySelector('#global-search')?.blur(); return; }
  if (event.key === 'Tab' && overlays.querySelector('.modal')) {
    const nodes = [...overlays.querySelectorAll('button:not(:disabled),a,input,[tabindex="0"]')];
    if (nodes.length && ((event.shiftKey && document.activeElement === nodes[0]) || (!event.shiftKey && document.activeElement === nodes.at(-1)))) {
      event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0]).focus();
    }
  }
  if (event.target.matches('input,textarea,select,[contenteditable]') || overlays.children.length) return;
  if (event.key === '/') { event.preventDefault(); document.querySelector(state.page === 'settings' ? '#settings-search' : '#global-search')?.focus(); }
  if (event.target.closest('button,a')) return;
  if (event.code === 'Space') { event.preventDefault(); act('toggle'); }
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') { event.preventDefault(); if (state.current) act('seek', { seconds: Math.max(0, state.current.position + (event.code === 'ArrowRight' ? 5 : -5)) }); }
});
async function loadHome() {
  state.loading = true; if (state.page === 'home') renderPage();
  try { state.home = (await api('home')).sections; } catch { state.home = []; }
  state.loading = false; if (state.page === 'home') renderPage();
}
async function start() {
  applyPreferences();
  try {
    const bootstrap = await api('bootstrap');
    Object.assign(state, {
      token: bootstrap.token, copy: bootstrap.copy, connected: bootstrap.connected,
      googleEnabled: bootstrap.googleEnabled, browserAccount: bootstrap.browserAccount,
      hosted: bootstrap.hosted, catalogAvailable: bootstrap.catalogAvailable, sessionUrl: bootstrap.sessionUrl,
    });
    if (location.hash === '#settings') state.page = 'settings';
    if (window.matchMedia('(max-width: 800px)').matches && localStorage.getItem('novax-layout-right') === null) state.right = false;
    restorePlayback();
    shell();
    if (state.right && localTrack()) refreshLyrics();
    const url = new URL(location.href);
    const googleResult = url.searchParams.get('google');
    if (googleResult) {
      toast(googleResult === 'cancelled' ? 'web-google-cancelled' : 'web-google-login-failed');
      url.searchParams.delete('google');
      history.replaceState(null, '', url);
    }
    if (state.page === 'settings') refreshProviderStatus();
    if (!state.hosted) watchDesktop();
    setInterval(updateProgress, 250);
    await loadHome();
  } catch { app.innerHTML = '<div class="boot"><img src="/assets/logo.svg" alt="NovaXCloud Music"><button class="solid" data-action="reload">NovaXCloud Music</button></div>'; }
}

function watchDesktop() {
  const events = new EventSource('/api/events');
  events.onmessage = event => {
    const value = JSON.parse(event.data); const wasConnected = state.connected;
    if (value.connected !== state.connected) { state.connected = value.connected; updateConnection(); }
    if (!wasConnected && value.connected && !state.home.length) loadHome();
    if (!wasConnected && value.connected && state.page === 'settings') refreshProviderStatus();
  };
  events.onerror = () => { state.connected = false; updateConnection(); };
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    updateProgress();
    checkpointPlayback(true);
  }
  if (!document.hidden && state.page === 'settings') refreshProviderStatus();
});
window.addEventListener('pagehide', () => {
  updateProgress();
  checkpointPlayback(true);
});
window.addEventListener('focus', () => {
  if (state.page === 'settings') refreshProviderStatus();
});
systemTheme.addEventListener('change', applyPreferences);
start();
