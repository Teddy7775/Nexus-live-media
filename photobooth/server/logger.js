import fs from 'node:fs';
import path from 'node:path';

/** Console + append-only log file. Logging must never take the booth down, so file errors are swallowed. */
export function createLogger({ file, quiet = false } = {}) {
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {
      /* logging is best-effort */
    }
  }
  const write = (level, message) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
    if (!quiet) (level === 'error' ? console.error : console.log)(line);
    if (file) fs.appendFile(file, `${line}\n`, () => {});
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}
