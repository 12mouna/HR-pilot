const EventEmitter = require('events');

/**
 * Shared in-memory progress tracker used by both the /scrape route (writer)
 * and the /scrape-status route (reader). Also emits 'update' events in case
 * we want to upgrade to SSE/WebSockets later without changing callers.
 */
class ProgressTracker extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.state = {
      running: false,
      step: 'idle', // idle | starting | discovering | scraping | done | error
      message: 'Idle. Click "Run Scrape" to start.',
      current: 0,
      total: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
    };
    return this.state;
  }

  start() {
    this.reset();
    this.state.running = true;
    this.state.step = 'starting';
    this.state.message = 'Initializing scrape run...';
    this.state.startedAt = new Date().toISOString();
    this.emit('update', this.state);
    return this.state;
  }

  update(partial) {
    this.state = { ...this.state, ...partial };
    this.emit('update', this.state);
    return this.state;
  }

  finish(message = 'Done') {
    this.state = {
      ...this.state,
      running: false,
      step: 'done',
      message,
      finishedAt: new Date().toISOString(),
    };
    this.emit('update', this.state);
    return this.state;
  }

  fail(error) {
    const errorMessage = error && error.message ? error.message : String(error);
    this.state = {
      ...this.state,
      running: false,
      step: 'error',
      error: errorMessage,
      message: `Error: ${errorMessage}`,
      finishedAt: new Date().toISOString(),
    };
    this.emit('update', this.state);
    return this.state;
  }

  getState() {
    return this.state;
  }
}

// Singleton instance shared across the whole app.
module.exports = new ProgressTracker();
