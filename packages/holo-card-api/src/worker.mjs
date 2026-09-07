import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cardDirectory, persistMask, assemble } from './images.mjs';
import { imageFrom } from './provider.mjs';
export class Worker {
  constructor(store, provider, { interval = 5000 } = {}) {
    this.store = store;
    this.provider = provider;
    this.interval = interval;
    this.stopping = false;
    this.busy = null;
    this.timer = null;
  }
  start() {
    this.store.recover();
    this.timer = setInterval(() => this.kick(), this.interval);
    this.timer.unref();
    this.kick();
  }
  kick() {
    if (this.stopping || this.busy) return;
    this.busy = this.tick()
      .catch(() => {
        /* Durable ledger is retried on a later tick; never repeat a submitted layer. */
      })
      .finally(() => {
        this.busy = null;
      });
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.busy;
  }
  async tick() {
    for (const job of this.store.active()) {
      if (this.stopping) break;
      await this.process(job);
    }
  }
  async process(job) {
    const card = this.store.card(job.card_id, job.owner);
    if (!card) {
      this.store.setJob(job.id, 'failed', 'SOURCE_MISSING');
      return;
    }
    this.store.setJob(job.id, 'running');
    const pending = this.store
      .layers(job.id)
      .filter((l) => l.status === 'pending');
    if (pending.length) {
      let source;
      try {
        source = await readFile(
          join(cardDirectory(this.store, card.id), 'source.png'),
        );
      } catch {
        this.store.setJob(job.id, 'failed', 'SOURCE_MISSING');
        return;
      }
      await Promise.all(
        pending.map(async (layer) => {
          if (!this.store.claim(job.id, layer.kind)) return;
          try {
            const result = await this.provider.submit(layer.kind, source);
            this.store.setLayer(job.id, layer.kind, {
              status: 'in_progress',
              provider_id: result.id,
              error: null,
            });
            await this.accept(job, card, layer.kind, result);
          } catch (error) {
            const current = this.store
              .layers(job.id)
              .find((l) => l.kind === layer.kind);
            if (current.status === 'submitting')
              this.store.setLayer(job.id, layer.kind, {
                status: error.uncertain === false ? 'failed' : 'uncertain',
                error: error.code ?? 'SUBMISSION_OUTCOME_UNKNOWN',
              });
          }
        }),
      );
    }
    // A layer accepted this tick may also be read once now. Reads never start a generation.
    await Promise.all(
      this.store
        .layers(job.id)
        .filter((l) => l.status === 'in_progress' && l.provider_id)
        .map(async (layer) => {
          try {
            await this.accept(
              job,
              card,
              layer.kind,
              await this.provider.retrieve(layer.provider_id),
            );
          } catch (error) {
            if (error.retryable !== false) {
              this.store.setLayer(job.id, layer.kind, {
                error: error.code ?? 'RESULT_READ_UNAVAILABLE',
              });
            } else
              this.store.setLayer(job.id, layer.kind, {
                status: 'failed',
                error: error.code ?? 'PROVIDER_RESULT_FAILED',
              });
          }
        }),
    );
    const layers = this.store.layers(job.id);
    if (layers.every((l) => l.status === 'completed')) {
      this.store.setJob(job.id, 'assembling');
      try {
        await assemble(this.store, card);
        this.store.setJob(job.id, 'completed');
      } catch {
        this.store.setJob(job.id, 'failed', 'ASSEMBLY_FAILED');
      }
    } else if (
      layers.some((l) =>
        ['pending', 'submitting', 'in_progress'].includes(l.status),
      )
    )
      this.store.setJob(job.id, 'running');
    else
      this.store.setJob(
        job.id,
        layers.some((l) => l.status === 'uncertain') ? 'uncertain' : 'failed',
        'LAYER_GENERATION_INCOMPLETE',
      );
  }
  async accept(job, card, kind, result) {
    if (result.status === 'completed') {
      const image = imageFrom(result);
      if (!image) {
        this.store.setLayer(job.id, kind, {
          status: 'failed',
          error: 'PROVIDER_NO_IMAGE',
        });
        return;
      }
      if (image.data.length > 17 * 1024 * 1024) {
        this.store.setLayer(job.id, kind, {
          status: 'failed',
          error: 'PROVIDER_IMAGE_TOO_LARGE',
        });
        return;
      }
      try {
        await persistMask(
          this.store,
          card,
          kind,
          Buffer.from(image.data, 'base64'),
        );
      } catch (error) {
        this.store.setLayer(job.id, kind, {
          status: 'failed',
          error:
            error.message === 'MASK_ASPECT_MISMATCH'
              ? 'MASK_ASPECT_MISMATCH'
              : 'INVALID_MASK_IMAGE',
        });
        return;
      }
      this.store.setLayer(job.id, kind, {
        status: 'completed',
        completed_at: Date.now(),
        error: null,
        usage: result.usage ? JSON.stringify(result.usage) : null,
      });
    } else if (
      ['failed', 'cancelled', 'requires_action'].includes(result.status)
    )
      this.store.setLayer(job.id, kind, {
        status: 'failed',
        error: `PROVIDER_${result.status.toUpperCase()}`,
      });
    else this.store.setLayer(job.id, kind, { error: null });
  }
}
