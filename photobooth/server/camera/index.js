import { MockCamera } from './mock.js';
import { DigiCamControlCamera } from './digicamcontrol.js';

export { CameraError } from './errors.js';

export function createCamera(config, { logger } = {}) {
  switch (config.camera.driver) {
    case 'mock':
      return new MockCamera(config.camera.mock, { logger });
    case 'digicamcontrol':
      return new DigiCamControlCamera(config.camera.digicamcontrol, { logger });
    default:
      throw new Error(`Unknown camera driver: ${config.camera.driver}`);
  }
}

/**
 * Keeps live view running only while someone is watching the preview stream.
 * Several viewers share one live view; it stops a few seconds after the last one leaves.
 */
export class LiveViewController {
  #clients = 0;
  #timer = null;
  #starting = null;
  #active = false;

  constructor(camera, { idleStopMs = 3000, logger } = {}) {
    this.camera = camera;
    this.idleStopMs = idleStopMs;
    this.log = logger;
  }

  async acquire() {
    this.#clients += 1;
    clearTimeout(this.#timer);
    if (this.#active) return;
    this.#starting ??= this.camera
      .startLiveView()
      .then(() => {
        this.#active = true;
      })
      .catch((err) => this.log?.warn?.(`live view did not start: ${err.message}`))
      .finally(() => {
        this.#starting = null;
      });
    await this.#starting;
  }

  release() {
    this.#clients = Math.max(0, this.#clients - 1);
    if (this.#clients > 0) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#active = false;
      this.camera.stopLiveView().catch((err) => this.log?.warn?.(`live view did not stop: ${err.message}`));
    }, this.idleStopMs);
  }
}
