import { homedir } from 'node:os';
import { join } from 'node:path';
import { createService } from './app.mjs';
const dataDir =
  process.env.HOLO_DATA_DIR ?? join(homedir(), '.local/share/holo-card');
const service = await createService({
  dataDir,
  apiKey: process.env.GEMINI_API_KEY,
  publicBaseUrl: process.env.HOLO_PUBLIC_BASE_URL?.replace(/\/$/, ''),
});
const url = await service.listen(
  Number(process.env.PORT ?? 8787),
  process.env.HOST ?? '127.0.0.1',
);
console.log(
  JSON.stringify({ event: 'listening', url, service: 'holo-card-api' }),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await service.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
