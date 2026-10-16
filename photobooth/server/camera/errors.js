/**
 * code:
 *   unavailable   - cannot talk to the camera software / no camera connected
 *   timeout       - the camera software did not answer in time
 *   capture_failed- the camera software reported an error while taking the photo
 *   file_missing  - the camera said "done" but no photo file appeared
 */
export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}
