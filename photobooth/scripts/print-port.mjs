// Prints the port from config.json (or the default). Used by start-booth.bat.
import { loadConfig } from '../server/config.js';

try {
  console.log(loadConfig().port);
} catch {
  console.log(3000);
}
