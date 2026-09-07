import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createService } from '../src/app.mjs';
import { digest } from '../src/store.mjs';
class MockProvider {
  configured = true;
  calls = [];
  polls = [];
  pending = false;
  failKind = null;
  constructor(mask) {
    this.mask = mask;
  }
  async submit(kind) {
    this.calls.push(kind);
    if (kind === this.failKind) {
      const e = new Error('network failed');
      e.uncertain = true;
      throw e;
    }
    return { id: kind, status: 'in_progress' };
  }
  async retrieve(id) {
    this.polls.push(id);
    if (this.pending) return { id, status: 'in_progress' };
    return {
      id,
      status: 'completed',
      usage: { total_tokens: 10 },
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'image',
              mime_type: 'image/png',
              data: this.mask.toString('base64'),
            },
          ],
        },
      ],
    };
  }
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'holo-api-test-'));
  const source = await sharp({
    create: {
      width: 70,
      height: 98,
      channels: 3,
      background: { r: 12, g: 130, b: 220 },
    },
  })
    .png()
    .toBuffer();
  const mask = await sharp({
    create: { width: 70, height: 98, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const provider = new MockProvider(mask);
  const api = await createService({ dataDir: dir, provider, interval: 25 });
  const credential = api.store.token();
  await api.listen(0);
  return {
    dir,
    source,
    provider,
    api,
    credential,
    async close() {
      await this.api.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function request(
  t,
  path,
  { method = 'GET', data, token = t.credential.token, headers = {} } = {},
) {
  const res = await fetch(t.api.baseUrl + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: data,
  });
  return res;
}
async function upload(t, name = 'Card') {
  const form = new FormData();
  form.append('file', new File([t.source], 'card.png', { type: 'image/png' }));
  form.append('name', name);
  const res = await request(t, '/v1/cards', { method: 'POST', data: form });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
async function start(t, id, key = 'stable-request-1') {
  const res = await request(t, `/v1/cards/${id}/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    data: JSON.stringify({ max_image_calls: 4 }),
  });
  assert.ok([200, 202].includes(res.status), await res.clone().text());
  return res.json();
}
async function finished(t, id) {
  for (let n = 0; n < 200; n++) {
    const job = await (await request(t, `/v1/jobs/${id}`)).json();
    if (['completed', 'failed', 'uncertain'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Job did not settle');
}
test('Full authenticated HTTP flow produces RGBA assets, standalone ZIP, and scoped expiring preview', async () => {
  const t = await setup();
  try {
    assert.equal((await request(t, '/v1/cards', { token: null })).status, 401);
    const card = await upload(t, 'Safe </script> title');
    assert.equal(card.source_sha256, digest(t.source));
    assert.equal(card.status, 'uploaded');
    assert.equal(t.provider.calls.length, 0);
    const original = Buffer.from(
      await (await request(t, card.original_url)).arrayBuffer(),
    );
    assert.deepEqual(original, t.source);
    const [a, b] = await Promise.all([start(t, card.id), start(t, card.id)]);
    assert.equal(a.id, b.id);
    const job = await finished(t, a.id);
    assert.equal(job.status, 'completed', JSON.stringify(job));
    assert.equal(job.progress.completed_layers, 4);
    assert.deepEqual([...t.provider.calls].sort(), [
      'background',
      'character',
      'structure',
      'ui',
    ]);
    assert.equal((await start(t, card.id)).id, a.id);
    assert.equal(t.provider.calls.length, 4);
    const conflict = await request(t, `/v1/cards/${card.id}/generations`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': 'another-request',
        'Content-Type': 'application/json',
      },
      data: '{"max_image_calls":4}',
    });
    assert.equal(conflict.status, 409);
    const material = await request(
      t,
      `/v1/cards/${card.id}/assets/character.png`,
    );
    assert.equal(material.status, 200);
    const pixels = await sharp(Buffer.from(await material.arrayBuffer()))
      .raw()
      .toBuffer();
    assert.deepEqual([...pixels.subarray(0, 4)], [12, 130, 220, 255]);
    const download = await request(t, `/v1/cards/${card.id}/bundle`);
    assert.equal(download.status, 200);
    const zip = Buffer.from(await download.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from('globalThis.HOLO_MANIFEST')));
    assert.ok(zip.includes(Buffer.from('Safe \\u003c/script> title')));
    assert.ok(!zip.includes(Buffer.from(t.credential.token)));
    const preview = await (
      await request(t, `/v1/cards/${card.id}/preview-links`, { method: 'POST' })
    ).json();
    const html = await fetch(preview.preview_url);
    assert.equal(html.status, 200);
    const url = new URL(preview.preview_url);
    const asset = new URL('assets/character.png' + url.search, url);
    assert.equal((await fetch(asset)).status, 200);
    assert.equal(
      (await fetch(new URL('assets/original' + url.search, url))).status,
      200,
    );
    const other = t.api.store.token({ name: 'other-agent' });
    assert.equal(
      (await request(t, `/v1/cards/${card.id}`, { token: other.token })).status,
      404,
    );
    assert.equal(
      (await request(t, `/v1/jobs/${a.id}`, { token: other.token })).status,
      404,
    );
    t.api.store.db.prepare('UPDATE previews SET expires_at=0').run();
    assert.equal((await fetch(preview.preview_url)).status, 403);
    const readOnly = t.api.store.token({
      scopes: ['cards:read'],
      owner: t.credential.owner,
    });
    assert.equal(
      (
        await request(t, `/v1/cards/${card.id}/generations`, {
          method: 'POST',
          token: readOnly.token,
        })
      ).status,
      403,
    );
    t.api.store.revoke(readOnly.id);
    assert.equal(
      (await request(t, '/v1/cards', { token: readOnly.token })).status,
      401,
    );
  } finally {
    await t.close();
  }
});
test('Unknown paid submission is terminal and never repeated by polling or restart', async () => {
  const t = await setup();
  try {
    t.provider.failKind = 'structure';
    const card = await upload(t);
    const job = await start(t, card.id);
    const result = await finished(t, job.id);
    assert.equal(result.status, 'uncertain');
    assert.equal(t.provider.calls.length, 4);
    await start(t, card.id);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(t.provider.calls.length, 4);
  } finally {
    await t.close();
  }
});
test('Worker resumes provider IDs after service restart and cannot read another owner assets', async () => {
  const t = await setup();
  try {
    t.provider.pending = true;
    const card = await upload(t);
    const job = await start(t, card.id);
    for (let i = 0; i < 100 && t.provider.calls.length < 4; i++)
      await new Promise((r) => setTimeout(r, 10));
    await t.api.worker.busy;
    await t.api.close();
    t.provider.pending = false;
    t.api = await createService({
      dataDir: t.dir,
      provider: t.provider,
      interval: 25,
    });
    await t.api.listen(0);
    const result = await finished(t, job.id);
    assert.equal(result.status, 'completed');
    assert.equal(t.provider.calls.length, 4);
    const other = t.api.store.token();
    assert.equal(
      (
        await request(t, `/v1/cards/${card.id}/assets/source.png`, {
          token: other.token,
        })
      ).status,
      404,
    );
  } finally {
    await t.close();
  }
});
test('Invalid input and missing cost/idempotency boundaries do not submit a provider call', async () => {
  const t = await setup();
  try {
    const form = new FormData();
    form.append(
      'file',
      new File(['not an image'], 'fake.png', { type: 'image/png' }),
    );
    assert.equal(
      (await request(t, '/v1/cards', { method: 'POST', data: form })).status,
      415,
    );
    const card = await upload(t);
    assert.equal(
      (
        await request(t, `/v1/cards/${card.id}/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: '{}',
        })
      ).status,
      400,
    );
    assert.equal(t.provider.calls.length, 0);
    assert.equal(
      (
        await request(t, '/v1/cards', {
          headers: { Origin: 'https://other.example' },
        })
      ).status,
      403,
    );
    const spec = await (await fetch(t.api.baseUrl + '/openapi.json')).json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(
      spec.paths['/v1/cards/{id}/generations'].post.parameters.some(
        (p) => p.name === 'Idempotency-Key',
      ),
    );
  } finally {
    await t.close();
  }
});

test('A second service cannot recover or submit work in an already-owned data directory',async()=>{
 const t=await setup();let second;
 try{second=await createService({dataDir:t.dir,provider:t.provider,interval:25});await assert.rejects(second.listen(0),/already using/);assert.equal((await fetch(t.api.baseUrl+'/healthz')).status,200);assert.equal(t.provider.calls.length,0);}finally{await second?.close();await t.close();}
});
