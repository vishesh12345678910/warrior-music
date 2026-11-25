/** Browser client for the native Sonora Sessions v1 wire protocol. */
export class ListeningRoom {
  #socket;
  #timer;
  #sequence = 0;
  #clockOffset = 0;

  constructor({ changed, received, failed }) {
    this.changed = changed;
    this.received = received;
    this.failed = failed;
    this.room = null;
  }

  connect(url, request) {
    this.leave();
    const socket = new WebSocket(url);
    this.#socket = socket;
    this.#sequence = 0;
    this.#clockOffset = 0;
    const create = request.type === 'create';
    const timeout = setTimeout(() => {
      if (this.#socket === socket && !this.room) {
        this.leave();
        this.failed('unreachable');
      }
    }, 10000);
    socket.addEventListener('open', () => {
      this.#send({ version: 1, image: null, ...request });
      this.#ping();
      this.#timer = setInterval(() => this.#ping(), 10000);
    });
    socket.addEventListener('message', event => {
      if (this.#socket !== socket) return;
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      if (reply.type === 'joined') {
        clearTimeout(timeout);
        this.room = { code: reply.code, you: reply.you, members: reply.members };
        this.changed(this.room, create);
        if (reply.state) this.#receive(reply.state);
      } else if (reply.type === 'members' && this.room) {
        this.room.members = reply.members;
        this.changed(this.room, false);
      } else if (reply.type === 'state' && this.room && reply.by !== this.room.you) {
        this.#receive(reply.state);
      } else if (reply.type === 'pong') {
        this.#clockOffset = reply.now - (reply.t + Date.now()) / 2;
      } else if (['ended', 'kicked', 'error'].includes(reply.type)) {
        clearTimeout(timeout);
        this.leave();
        this.failed(reply.reason || reply.type);
      }
    });
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      if (this.#socket !== socket) return;
      this.leave();
      this.failed('unreachable');
    });
  }

  leave() {
    clearInterval(this.#timer);
    this.#send({ type: 'leave' });
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    if (this.room) {
      this.room = null;
      this.changed(null, false);
    }
  }

  publish(state) {
    if (this.room) this.#send({ type: 'state', seq: ++this.#sequence, state });
  }

  #ping() { this.#send({ type: 'ping', t: Date.now() }); }

  #send(message) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  #receive(state) {
    const elapsed = state.playing && state.at ? Math.max(0, Date.now() + this.#clockOffset - state.at) : 0;
    this.received(state, (state.position + elapsed) / 1000);
  }
}
