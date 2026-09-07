import { readFileSync } from 'node:fs';
const document = JSON.parse(
  readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
);
export function openapi(base) {
  return { ...document, servers: [{ url: base }] };
}
