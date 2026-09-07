import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function acquireLock(directory) {
  const path = join(directory, 'service.lock'),
    nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      await file.close();
      return async () => {
        try {
          const value = JSON.parse(await readFile(path, 'utf8'));
          if (value.nonce === nonce) await unlink(path);
        } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = JSON.parse(await readFile(path, 'utf8'));
      if (!Number.isInteger(prior.pid) || prior.pid <= 0)
        throw new Error(
          'Invalid service lock; inspect it before starting another instance.',
        );
      try {
        process.kill(prior.pid, 0);
        throw new Error('A service is already using this data directory.');
      } catch (status) {
        if (status.code !== 'ESRCH') throw status;
      }
      await unlink(path);
    }
  }
  throw new Error('Could not claim the service data directory.');
}
