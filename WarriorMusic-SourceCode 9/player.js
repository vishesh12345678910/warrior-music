/**
 * Warrior Music - High-Resilience Dual Audio Engine
 *
 * Supports both YouTube IFrame Player (for full YouTube tracks)
 * and HTML5 Audio Element (for direct streams/previews/fallback audio).
 */

const API = 'https://www.youtube.com/iframe_api';
let apiPromise = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const timer = setTimeout(() => {
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('player_timeout'));
    }, 20000);

    const prevOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof prevOnReady === 'function') prevOnReady();
      resolve(window.YT);
    };

    if (!document.querySelector(`script[src*="youtube.com/iframe_api"]`)) {
      const script = document.createElement('script');
      script.src = API;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('player_blocked'));
      };
      document.head.append(script);
    }
  });

  return apiPromise;
}

const label = code => {
  if (code === 1) return 'playing';
  if (code === 2) return 'paused';
  if (code === 3) return 'loading';
  if (code === 0) return 'ended';
  return null;
};

export class BrowserPlayer {
  #host;
  #handlers;
  #player = null;
  #audio = null;
  #mode = 'yt';
  #volume = 70;
  #muted = false;
  #mounting = null;
  #isReady = false;

  constructor(host, handlers = {}) {
    this.#host = host;
    this.#handlers = handlers;

    // Create dedicated HTML5 Audio element
    this.#audio = new Audio();
    this.#audio.preload = 'auto';
    this.#audio.addEventListener('play', () => {
      if (this.#mode === 'audio') this.#handlers.change?.('playing');
    });
    this.#audio.addEventListener('pause', () => {
      if (this.#mode === 'audio') this.#handlers.change?.('paused');
    });
    this.#audio.addEventListener('waiting', () => {
      if (this.#mode === 'audio') this.#handlers.change?.('loading');
    });
    this.#audio.addEventListener('ended', () => {
      if (this.#mode === 'audio') this.#handlers.ended?.();
    });
    this.#audio.addEventListener('error', err => {
      if (this.#mode === 'audio') {
        console.warn('HTML5 audio error:', err);
        this.#handlers.error?.(err);
      }
    });
  }

  get ready() {
    return this.#isReady;
  }

  mount() {
    return this.#mount();
  }

  #mount() {
    if (this.#isReady && this.#player) return Promise.resolve();
    if (this.#mounting) return this.#mounting;

    this.#mounting = loadApi().then(api => new Promise((resolve, reject) => {
      let container = document.getElementById('warrior-player-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'warrior-player-container';
        this.#host.append(container);
      }

      const timer = setTimeout(() => {
        if (this.#isReady) {
          resolve();
        } else {
          reject(new Error('player_timeout'));
        }
      }, 15000);

      const pageOrigin = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) 
        ? window.location.origin 
        : 'https://www.youtube.com';

      try {
        this.#player = new api.Player(container, {
          width: 320,
          height: 180,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: pageOrigin,
          },
          events: {
            onReady: () => {
              clearTimeout(timer);
              this.#isReady = true;
              try {
                const iframe = this.#player.getIframe();
                if (iframe) {
                  iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
                  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                }
              } catch {}
              this.#applyVolume();
              resolve();
            },
            onStateChange: event => {
              if (this.#mode !== 'yt') return;
              const state = label(event.data);
              if (state === 'ended') this.#handlers.ended?.();
              else if (state) this.#handlers.change?.(state);
            },
            onError: event => {
              if (this.#mode !== 'yt') return;
              console.warn('warrior-yt-error', event?.data);
              this.#handlers.error?.(event?.data);
            },
          },
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })).catch(error => {
      console.warn('WarriorPlayer mount note:', error);
      this.#mounting = null;
      throw error;
    });

    return this.#mounting;
  }

  async load(target, { start = 0 } = {}) {
    const isUrl = typeof target === 'string' && (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('blob:') || target.endsWith('.mp3') || target.endsWith('.m4a'));

    if (isUrl) {
      this.#mode = 'audio';
      try { this.#player?.pauseVideo?.(); } catch {}
      this.#audio.src = target;
      this.#audio.currentTime = Math.max(0, start);
      this.#applyVolume();
      try {
        await this.#audio.play();
      } catch (e) {
        console.warn('Audio play failed:', e);
      }
      return;
    }

    this.#mode = 'yt';
    try { this.#audio?.pause(); } catch {}

    await this.#mount();

    const startSeconds = Math.max(0, Math.floor(start));
    try {
      this.#player.loadVideoById({ videoId: target, startSeconds });
    } catch {
      try {
        this.#player?.cueVideoById?.({ videoId: target, startSeconds });
      } catch {}
    }
    this.#applyVolume();
    try {
      this.#player?.playVideo?.();
    } catch {}
  }

  play() {
    if (this.#mode === 'audio') {
      this.#audio?.play().catch(e => console.warn('Audio play failed:', e));
    } else {
      try { this.#player?.playVideo?.(); } catch {}
    }
  }

  pause() {
    if (this.#mode === 'audio') {
      this.#audio?.pause();
    } else {
      try { this.#player?.pauseVideo?.(); } catch {}
    }
  }

  seek(seconds) {
    const s = Math.max(0, seconds);
    if (this.#mode === 'audio') {
      if (this.#audio) this.#audio.currentTime = s;
    } else {
      if (!this.ready) return;
      try { this.#player?.seekTo?.(s, true); } catch {}
    }
  }

  volume(percent) {
    this.#volume = Math.min(100, Math.max(0, Math.round(percent)));
    this.#applyVolume();
  }

  mute(muted) {
    this.#muted = Boolean(muted);
    this.#applyVolume();
  }

  time() {
    if (this.#mode === 'audio') {
      return this.#audio?.currentTime ?? null;
    }
    if (!this.ready) return null;
    try {
      const value = this.#player?.getCurrentTime?.();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  duration() {
    if (this.#mode === 'audio') {
      const d = this.#audio?.duration;
      return (d && !isNaN(d) && isFinite(d)) ? d : null;
    }
    if (!this.ready) return null;
    try {
      const value = this.#player?.getDuration?.();
      return (Number.isFinite(value) && value > 0) ? value : null;
    } catch {
      return null;
    }
  }

  #applyVolume() {
    const vol = this.#muted ? 0 : this.#volume;
    if (this.#audio) {
      this.#audio.volume = vol / 100;
    }
    if (this.ready) {
      try {
        this.#player?.setVolume?.(vol);
      } catch {}
    }
  }
}
