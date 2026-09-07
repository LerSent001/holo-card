import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
export const kinds = ['character', 'background', 'ui', 'structure'];
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(directory) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.directory, 'holo.sqlite'));
    chmodSync(join(this.directory, 'holo.sqlite'), 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
   CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS cards_owner_created ON cards(owner,created_at);
   CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, card_id TEXT NOT NULL UNIQUE REFERENCES cards(id), owner TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, UNIQUE(owner,request_key));
   CREATE TABLE IF NOT EXISTS layers (job_id TEXT NOT NULL REFERENCES jobs(id), kind TEXT NOT NULL, status TEXT NOT NULL, provider_id TEXT, error TEXT, submitted_at INTEGER, completed_at INTEGER, usage TEXT, PRIMARY KEY(job_id,kind));
   CREATE TABLE IF NOT EXISTS previews (digest TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), expires_at INTEGER NOT NULL);
   PRAGMA user_version=1;`);
  }
  token({
    name = 'local-codex',
    owner = randomUUID(),
    scopes = ['cards:read', 'cards:write', 'generations:create'],
  } = {}) {
    const secret = `holo_${randomBytes(32).toString('base64url')}`,
      id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO api_tokens (id,name,digest,owner,scopes,created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(id, name, digest(secret), owner, JSON.stringify(scopes), Date.now());
    return { id, token: secret, owner, scopes };
  }
  authenticate(secret, scope) {
    const token = this.db
      .prepare('SELECT * FROM api_tokens WHERE digest=? AND revoked_at IS NULL')
      .get(digest(secret));
    if (!token) return null;
    return JSON.parse(token.scopes).includes(scope) ? token : false;
  }
  revoke(id) {
    return this.db
      .prepare('UPDATE api_tokens SET revoked_at=? WHERE id=?')
      .run(Date.now(), id).changes;
  }
  card(id, owner) {
    return this.db
      .prepare('SELECT * FROM cards WHERE id=? AND owner=?')
      .get(id, owner);
  }
  job(id, owner) {
    return this.db
      .prepare('SELECT * FROM jobs WHERE id=? AND owner=?')
      .get(id, owner);
  }
  cardJob(id) {
    return this.db.prepare('SELECT * FROM jobs WHERE card_id=?').get(id);
  }
  layers(id) {
    const rows = this.db.prepare('SELECT * FROM layers WHERE job_id=?').all(id);
    return kinds
      .map((kind) => rows.find((row) => row.kind === kind))
      .filter(Boolean);
  }
  createCard({ id, owner, name, mime, sha256, width, height }) {
    this.db
      .prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?)')
      .run(id, owner, name, mime, sha256, width, height, Date.now());
    return this.card(id, owner);
  }
  createJob(card, key, hash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare('SELECT * FROM jobs WHERE owner=? AND request_key=?')
        .get(card.owner, key);
      if (existing) {
        this.db.exec('COMMIT');
        return {
          job: existing,
          replayed: true,
          conflict: existing.request_hash !== hash,
        };
      }
      const prior = this.cardJob(card.id);
      if (prior) {
        this.db.exec('COMMIT');
        return { job: prior, conflict: true };
      }
      const id = randomUUID(),
        now = Date.now();
      this.db
        .prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,NULL)')
        .run(id, card.id, card.owner, key, hash, 'queued', now, now);
      for (const kind of kinds)
        this.db
          .prepare('INSERT INTO layers (job_id,kind,status) VALUES (?,?,?)')
          .run(id, kind, 'pending');
      this.db.exec('COMMIT');
      return {
        job: this.job(id, card.owner),
        replayed: false,
        conflict: false,
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  setLayer(job, kind, fields) {
    const allowed = [
      'status',
      'provider_id',
      'error',
      'submitted_at',
      'completed_at',
      'usage',
    ];
    const pairs = Object.entries(fields).filter(([k]) => allowed.includes(k));
    this.db
      .prepare(
        `UPDATE layers SET ${pairs.map(([k]) => `${k}=?`).join(',')} WHERE job_id=? AND kind=?`,
      )
      .run(...pairs.map(([, v]) => v), job, kind);
    this.db
      .prepare('UPDATE jobs SET updated_at=? WHERE id=?')
      .run(Date.now(), job);
  }
  claim(job, kind) {
    return (
      this.db
        .prepare(
          "UPDATE layers SET status='submitting',submitted_at=? WHERE job_id=? AND kind=? AND status='pending'",
        )
        .run(Date.now(), job, kind).changes === 1
    );
  }
  setJob(id, status, error = null) {
    this.db
      .prepare('UPDATE jobs SET status=?,updated_at=?,error=? WHERE id=?')
      .run(status, Date.now(), error, id);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE layers SET status='uncertain',error='SUBMISSION_OUTCOME_UNKNOWN' WHERE status='submitting' AND provider_id IS NULL",
      )
      .run();
  }
  active() {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE status IN ('queued','running','assembling') ORDER BY created_at LIMIT 10",
      )
      .all();
  }
  preview(id, ttl = 900000) {
    const secret = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM previews WHERE expires_at<?').run(Date.now());
    this.db
      .prepare('INSERT INTO previews VALUES (?,?,?)')
      .run(digest(secret), id, Date.now() + ttl);
    return secret;
  }
  previewAllowed(id, secret) {
    return !!this.db
      .prepare(
        'SELECT 1 FROM previews WHERE digest=? AND card_id=? AND expires_at>?',
      )
      .get(digest(secret), id, Date.now());
  }
  close() {
    this.db.close();
  }
}
