import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, digest, kinds } from './store.mjs';
import { Gemini, MODEL } from './provider.mjs';
import { Worker } from './worker.mjs';
import {
  normalize,
  saveInput,
  cardDirectory,
  assemblyInfo,
} from './images.mjs';
import { zip } from './zip.mjs';
import { standalone } from './bundle.mjs';
import { openapi } from './openapi.mjs';
import { acquireLock } from './lock.mjs';
const assetDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);
const allowedAssets = new Set([
  'original',
  'source.png',
  ...kinds.flatMap((k) => [`${k}.png`, `${k}.mask.png`]),
]);
class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function body(req, limit) {
  const chunks = [];
  let size = 0;
  if (Number(req.headers['content-length'] ?? 0) > limit)
    fail(413, 'PAYLOAD_TOO_LARGE');
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function respond(res, status, value, type = 'application/json') {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(type === 'application/json' ? JSON.stringify(value) : value);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(bytes);
}
function jobView(store, job) {
  const ls = store.layers(job.id);
  return {
    id: job.id,
    card_id: job.card_id,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    model: MODEL,
    max_image_calls: 4,
    progress: {
      completed_layers: ls.filter((l) => l.status === 'completed').length,
      total_layers: 4,
    },
    error: job.error,
    layers: ls.map((l) => ({
      kind: l.kind,
      status: l.status,
      error: l.error,
      submitted_at: l.submitted_at,
      completed_at: l.completed_at,
      usage: l.usage ? JSON.parse(l.usage) : null,
    })),
    card_url: `/v1/cards/${job.card_id}`,
  };
}
async function cardView(store, card) {
  const job = store.cardJob(card.id),
    complete = job?.status === 'completed';
  return {
    id: card.id,
    name: card.name,
    status: job?.status ?? 'uploaded',
    width: card.width,
    height: card.height,
    created_at: card.created_at,
    source_sha256: card.sha256,
    original_url: `/v1/cards/${card.id}/assets/original`,
    source_url: `/v1/cards/${card.id}/assets/source.png`,
    job_id: job?.id ?? null,
    layers: kinds.map((kind) => ({
      kind,
      rgba_url: complete ? `/v1/cards/${card.id}/assets/${kind}.png` : null,
      mask_url:
        job &&
        store.layers(job.id).find((l) => l.kind === kind)?.status ===
          'completed'
          ? `/v1/cards/${card.id}/assets/${kind}.mask.png`
          : null,
    })),
    bundle_url: complete ? `/v1/cards/${card.id}/bundle` : null,
    preview_link_endpoint: complete
      ? `/v1/cards/${card.id}/preview-links`
      : null,
    assembly: complete ? await assemblyInfo(store, card.id) : null,
  };
}
export async function createService({
  dataDir,
  apiKey,
  provider = new Gemini(apiKey),
  interval = 5000,
  publicBaseUrl,
} = {}) {
  const store = new Store(dataDir),
    worker = new Worker(store, provider, { interval });
  let baseUrl,
    releaseLock,
    closed = false;
  function owned(id, principal) {
    if (!uuid.test(id)) fail(404, 'CARD_NOT_FOUND');
    const card = store.card(id, principal.owner);
    if (!card) fail(404, 'CARD_NOT_FOUND');
    return card;
  }
  function ready(card) {
    if (store.cardJob(card.id)?.status !== 'completed')
      fail(409, 'CARD_NOT_READY');
  }
  async function asset(res, card, name) {
    if (!allowedAssets.has(name)) fail(404, 'ASSET_NOT_FOUND');
    if (name !== 'original' && name !== 'source.png') {
      const k = name.split('.')[0];
      const job = store.cardJob(card.id);
      if (
        !job ||
        store.layers(job.id).find((l) => l.kind === k)?.status !== 'completed'
      )
        fail(404, 'ASSET_NOT_READY');
      if (!name.includes('.mask.')) ready(card);
    }
    let bytes;
    try {
      bytes = await readFile(join(cardDirectory(store, card.id), name));
    } catch {
      fail(404, 'ASSET_NOT_FOUND');
    }
    respond(res, 200, bytes, name === 'original' ? card.mime : 'image/png');
  }
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    try {
      const url = new URL(req.url, 'http://internal'),
        path = url.pathname,
        method = req.method;
      if (path === '/healthz' && method === 'GET')
        return respond(res, 200, {
          ok: true,
          service: 'holo-card-api',
          version: '1.0.0',
        });
      if (path === '/openapi.json' && method === 'GET')
        return respond(res, 200, openapi(baseUrl));
      const preview = path.match(
        /^\/view\/([^/]+)\/(index.html|renderer.js|viewer.js|viewer.css|back.png|manifest.json|assets\/[^/]+)$/,
      );
      if (preview && method === 'GET') {
        const [, id, name] = preview,
          secret = url.searchParams.get('access') ?? '';
        if (!uuid.test(id) || !store.previewAllowed(id, secret))
          fail(403, 'PREVIEW_EXPIRED_OR_INVALID');
        const card = store.db.prepare('SELECT * FROM cards WHERE id=?').get(id);
        ready(card);
        if (name === 'manifest.json')
          return respond(res, 200, {
            name: card.name,
            width: card.width,
            height: card.height,
            assets: Object.fromEntries(
              kinds.map((k) => [
                k,
                `assets/${k}.png?access=${encodeURIComponent(secret)}`,
              ]),
            ),
          });
        if (name.startsWith('assets/'))
          return await asset(res, card, name.slice(7));
        if (name === 'back.png')
          return respond(
            res,
            200,
            await readFile(join(assetDirectory, 'back.png')),
            'image/png',
          );
        const types = {
          'index.html': 'text/html; charset=utf-8',
          'viewer.js': 'text/javascript; charset=utf-8',
          'renderer.js': 'text/javascript; charset=utf-8',
          'viewer.css': 'text/css; charset=utf-8',
        };
        let bytes = await readFile(join(assetDirectory, name), 'utf8');
        if (name === 'index.html')
          bytes = bytes.replaceAll('__ACCESS__', encodeURIComponent(secret));
        return respond(res, 200, bytes, types[name]);
      }
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer '))
        fail(401, 'UNAUTHENTICATED', 'A bearer API token is required.');
      const scope = path.endsWith('/generations')
        ? 'generations:create'
        : method === 'POST' && path === '/v1/cards'
          ? 'cards:write'
          : 'cards:read';
      const principal = store.authenticate(auth.slice(7), scope);
      if (principal === null) fail(401, 'INVALID_TOKEN');
      if (principal === false) fail(403, 'INSUFFICIENT_SCOPE');
      const origin = req.headers.origin;
      if (origin && origin !== baseUrl) fail(403, 'ORIGIN_NOT_ALLOWED');
      if (path === '/v1/status' && method === 'GET')
        return respond(res, 200, {
          service: 'holo-card-api',
          version: '1.0.0',
          provider: 'gemini',
          provider_configured: provider.configured,
          completed_generations: store.db
            .prepare(
              "SELECT count(*) AS count FROM jobs WHERE owner=? AND status='completed'",
            )
            .get(principal.owner).count,
          model: MODEL,
          scopes: JSON.parse(principal.scopes),
          max_image_calls_per_card: 4,
        });
      if (path === '/v1/cards' && method === 'GET') {
        const limit = Math.min(
            100,
            Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50),
          ),
          offset = Math.max(
            0,
            Number(url.searchParams.get('offset') ?? 0) || 0,
          );
        const rows = store.db
          .prepare(
            'SELECT * FROM cards WHERE owner=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
          )
          .all(principal.owner, Math.trunc(limit), Math.trunc(offset));
        return respond(res, 200, {
          cards: await Promise.all(rows.map((c) => cardView(store, c))),
          limit: Math.trunc(limit),
          offset: Math.trunc(offset),
        });
      }
      if (path === '/v1/cards' && method === 'POST') {
        let form;
        try {
          form = await new Request('http://internal', {
            method: 'POST',
            headers: { 'content-type': req.headers['content-type'] ?? '' },
            body: await body(req, 8 * 1024 * 1024 + 16384),
          }).formData();
        } catch (error) {
          if (error instanceof HttpError) throw error;
          fail(400, 'INVALID_MULTIPART');
        }
        const file = form.get('file');
        if (
          !(file instanceof File) ||
          file.size === 0 ||
          file.size > 8 * 1024 * 1024
        )
          fail(
            400,
            'INVALID_FILE',
            'Expected one PNG/JPEG/WebP image up to 8 MiB.',
          );
        const bytes = Buffer.from(await file.arrayBuffer());
        let image;
        try {
          image = await normalize(bytes);
        } catch {
          fail(
            415,
            'INVALID_IMAGE',
            'Expected a single PNG/JPEG/WebP frame up to 24 megapixels.',
          );
        }
        const id = randomUUID(),
          name =
            String(form.get('name') ?? file.name.replace(/\.[^.]+$/, '')).slice(
              0,
              100,
            ) || 'Untitled card';
        await saveInput(store, id, bytes, image.bytes);
        let card;
        try {
          card = store.createCard({
            id,
            owner: principal.owner,
            name,
            mime: image.mime,
            sha256: digest(bytes),
            width: image.width,
            height: image.height,
          });
        } catch (error) {
          await rm(cardDirectory(store, id), { recursive: true, force: true });
          throw error;
        }
        return respond(res, 201, await cardView(store, card));
      }
      let match = path.match(
        /^\/v1\/cards\/([^/]+)(?:\/(generations|bundle|preview-links|assets\/[^/]+))?$/,
      );
      if (match) {
        const [, id, action] = match,
          card = owned(id, principal);
        if (!action && method === 'GET')
          return respond(res, 200, await cardView(store, card));
        if (action === 'generations' && method === 'POST') {
          const key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
            fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
          let options;
          try {
            options = JSON.parse((await body(req, 4096)).toString());
          } catch (error) {
            if (error instanceof HttpError) throw error;
            fail(400, 'INVALID_JSON');
          }
          if (
            !options ||
            options.max_image_calls !== 4 ||
            Object.keys(options).length !== 1
          )
            fail(
              400,
              'GENERATION_LIMIT_REQUIRED',
              'Pass {"max_image_calls":4} to authorize at most four 1K image requests.',
            );
          if (!provider.configured) fail(503, 'PROVIDER_NOT_CONFIGURED');
          const { job, replayed, conflict } = store.createJob(
            card,
            key,
            digest(
              JSON.stringify({ card_id: id, max_image_calls: 4, model: MODEL }),
            ),
          );
          if (conflict)
            fail(
              409,
              'GENERATION_ALREADY_EXISTS',
              'Query this card’s existing job; do not resubmit with a new key.',
            );
          worker.kick();
          res.setHeader('Location', `/v1/jobs/${job.id}`);
          return respond(res, replayed ? 200 : 202, jobView(store, job));
        }
        if (action?.startsWith('assets/') && method === 'GET')
          return await asset(res, card, action.slice(7));
        if (action === 'preview-links' && method === 'POST') {
          ready(card);
          const access = store.preview(id);
          return respond(res, 200, {
            preview_url: `${baseUrl}/view/${id}/index.html?access=${access}`,
            expires_in: 900,
          });
        }
        if (action === 'bundle' && method === 'GET') {
          ready(card);
          const entries = [];
          for (const name of [
            'renderer.js',
            'viewer.js',
            'viewer.css',
            'back.png',
          ])
            entries.push([name, await readFile(join(assetDirectory, name))]);
          entries.push([
            'index.html',
            await standalone(store, card, assetDirectory),
          ]);
          for (const name of [
            'source.png',
            ...kinds.flatMap((k) => [`${k}.png`, `${k}.mask.png`]),
          ])
            entries.push([
              `assets/${name}`,
              await readFile(join(cardDirectory(store, id), name)),
            ]);
          const assets = Object.fromEntries(
            kinds.map((k) => [k, `assets/${k}.png`]),
          );
          entries.push([
            'manifest.json',
            JSON.stringify(
              {
                name: card.name,
                width: card.width,
                height: card.height,
                assets,
              },
              null,
              2,
            ),
          ]);
          entries.push([
            'provenance.json',
            JSON.stringify(
              {
                card: await cardView(store, card),
                generation: jobView(store, store.cardJob(id)),
                quality_review: 'not_automatically_verified',
                repairs: false,
              },
              null,
              2,
            ),
          ]);
          entries.push([
            'README.txt',
            'Open index.html directly in a modern browser. All required images and renderer code are embedded; no server or network is needed. Drag to rotate, click/Space to flip, arrow keys to tilt. No API credentials are included. AI mask accuracy still requires visual review.\n',
          ]);
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="holo-card-${id}.zip"`,
          );
          return respond(res, 200, zip(entries), 'application/zip');
        }
        fail(405, 'METHOD_NOT_ALLOWED');
      }
      match = path.match(/^\/v1\/jobs\/([^/]+)$/);
      if (match && method === 'GET') {
        if (!uuid.test(match[1])) fail(404, 'JOB_NOT_FOUND');
        const job = store.job(match[1], principal.owner);
        if (!job) fail(404, 'JOB_NOT_FOUND');
        return respond(res, 200, jobView(store, job));
      }
      fail(404, 'NOT_FOUND');
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      respond(res, status, {
        error: {
          code:
            error.code && error instanceof HttpError
              ? error.code
              : 'INTERNAL_ERROR',
          message:
            error instanceof HttpError
              ? error.message
              : 'The operation could not be completed. Check the saved job before retrying.',
          request_id: requestId,
        },
      });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  return {
    store,
    worker,
    server,
    get baseUrl() {
      return baseUrl;
    },
    async listen(port = 8787, host = '127.0.0.1') {
      releaseLock = await acquireLock(store.directory);
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, host, resolve);
        });
      } catch (error) {
        await releaseLock();
        releaseLock = null;
        throw error;
      }
      baseUrl =
        publicBaseUrl ??
        `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}`;
      worker.start();
      return baseUrl;
    },
    async close() {
      if (closed) return;
      closed = true;
      await worker.stop();
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
      await releaseLock?.();
      store.close();
    },
  };
}
