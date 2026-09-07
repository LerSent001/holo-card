import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kinds } from './store.mjs';
import { cardDirectory } from './images.mjs';
export async function standalone(store, card, assetsDirectory) {
  const manifest = {
    name: card.name,
    width: card.width,
    height: card.height,
    assets: {},
    back:
      'data:image/png;base64,' +
      (await readFile(join(assetsDirectory, 'back.png'))).toString('base64'),
  };
  for (const kind of kinds)
    manifest.assets[kind] =
      'data:image/png;base64,' +
      (
        await readFile(join(cardDirectory(store, card.id), `${kind}.png`))
      ).toString('base64');
  const [html, css, renderer, viewer] = await Promise.all(
    ['index.html', 'viewer.css', 'renderer.js', 'viewer.js'].map((name) =>
      readFile(join(assetsDirectory, name), 'utf8'),
    ),
  );
  const state = JSON.stringify(manifest).replaceAll('<', '\\u003c');
  const script = `globalThis.HOLO_MANIFEST=${state};\n${renderer.replace('export async function createCardRenderer', 'async function createCardRenderer')}\nglobalThis.HOLO_CREATE_RENDERER=createCardRenderer;\n${viewer}`;
  return html
    .replace(
      '<link rel="stylesheet" href="viewer.css?access=__ACCESS__">',
      `<style>${css}</style>`,
    )
    .replace(
      '<script type="module" src="viewer.js?access=__ACCESS__"></script>',
      `<script type="module">${script}</script>`,
    );
}
