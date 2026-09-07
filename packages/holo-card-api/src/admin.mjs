import { Store } from './store.mjs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2),
  command = args.shift();
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
}
const store = new Store(
  option(
    'data-dir',
    process.env.HOLO_DATA_DIR ?? join(homedir(), '.local/share/holo-card'),
  ),
);
try {
  if (command === 'token-create') {
    const output = option('output');
    if (!output)
      throw new Error(
        '--output is required; tokens are written to a private file, never stdout.',
      );
    const scopes = option(
      'scopes',
      'cards:read,cards:write,generations:create',
    ).split(',');
    if (
      scopes.some(
        (s) => !['cards:read', 'cards:write', 'generations:create'].includes(s),
      )
    )
      throw new Error('Unknown scope.');
    const credential = store.token({
      name: option('name', 'local-codex'),
      owner: option('owner'),
      scopes,
    });
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(
      output,
      JSON.stringify(
        {
          api_url: option('url', 'http://127.0.0.1:8787'),
          api_token: credential.token,
          token_id: credential.id,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        token_id: credential.id,
        owner: credential.owner,
        scopes,
        credential_file: output,
      }),
    );
  } else if (command === 'token-revoke') {
    const id = option('id');
    if (!id) throw new Error('--id is required');
    console.log(JSON.stringify({ revoked: store.revoke(id) > 0 }));
  } else if (command === 'tokens') {
    console.log(
      JSON.stringify(
        store.db
          .prepare(
            'SELECT id,name,owner,scopes,created_at,revoked_at FROM api_tokens',
          )
          .all(),
        null,
        2,
      ),
    );
  } else
    throw new Error(
      'Usage: admin.mjs token-create --output PATH [--name NAME] [--owner ID] [--scopes LIST], token-revoke --id ID, or tokens.',
    );
} finally {
  store.close();
}
