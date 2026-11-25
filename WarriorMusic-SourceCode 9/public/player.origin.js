/**
 * Browser playback for the local web player.
 *
 * Audio is played by an embedded YouTube player inside this page, so the website
 * has its own queue and output. Nothing here talks to the desktop app's player:
 * the desktop engine is only asked for search results.
 */

const API = 'https://www.youtube.com/iframe_api';
let apiPromise = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('player_timeout')), 20000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('player_blocked'));
    };
    document.head.append(script);
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
  #volume = 70;
  #muted = false;
  #mounting = null;
  #isReady = false;

  constructor(host, handlers = {}) {
    this.#host = host;
    this.#handlers = handlers;
  }

  get ready() {
    return this.#isReady;
  }

  #mount() {
    if (this.ready) return Promise.resolve();
    if (this.#mounting) return this.#mounting;
    this.#mounting = loadApi().then(api => new Promise((resolve, reject) => {
      const element = document.createElement('div');
      element.id = 'novax-browser-audio';
      this.#host.append(element);
      const timer = setTimeout(() => reject(new Error('player_timeout')), 15000);
      this.#player = new api.Player(element, {
        width: 320,
        height: 180,
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0,
          origin: location.origin, enablejsapi: 1,
        },
        events: {
          onReady: () => {
            clearTimeout(timer);
            this.#isReady = true;
            this.#applyVolume();
            resolve();
          },
          onStateChange: event => {
            const state = label(event.data);
            if (state === 'ended') this.#handlers.ended?.();
            else if (state) this.#handlers.change?.(state);
          },
          onError: event => {
            console.warn('novax-player-error', event?.data);
            this.#handlers.error?.(event?.data);
          },
        },
      });
    })).catch(error => {
      this.#mounting = null;
      this.#player?.destroy?.();
      this.#player = null;
      this.#host.replaceChildren();
      throw error;
    });
    return this.#mounting;
  }

  async load(videoId, { start = 0 } = {}) {
    await this.#mount();
    this.#player.loadVideoById({ videoId, startSeconds: Math.max(0, Math.floor(start)) });
    this.#applyVolume();
  }

  play() {
    this.#player?.playVideo();
  }

  pause() {
    this.#player?.pauseVideo();
  }

  seek(seconds) {
    if (!this.ready) return;
    this.#player.seekTo(Math.max(0, seconds), true);
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
    if (!this.ready) return null;
    const value = this.#player.getCurrentTime?.();
    return Number.isFinite(value) ? value : null;
  }

  duration() {
    if (!this.ready) return null;
    const value = this.#player.getDuration?.();
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  #applyVolume() {
    if (!this.ready) return;
    this.#player.setVolume(this.#muted ? 0 : this.#volume);
  }
}
