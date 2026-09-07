import sharp from 'sharp';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { kinds } from './store.mjs';
export async function atomic(path, bytes) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, path);
}
export function cardDirectory(store, id) {
  return join(store.directory, 'cards', id);
}
export async function normalize(input) {
  const metadata = await sharp(input, {
    limitInputPixels: 24_000_000,
    animated: false,
  }).metadata();
  if (
    !['png', 'jpeg', 'webp'].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error('INVALID_IMAGE');
  const image = await sharp(input, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColourspace('srgb').ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: image.data,
    width: image.info.width,
    height: image.info.height,
    mime: `image/${metadata.format}`,
  };
}
export async function persistMask(store, card, kind, input) {
  const metadata = await sharp(input, {
    limitInputPixels: 16_000_000,
    animated: false,
  }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
    throw new Error('INVALID_MASK_IMAGE');
  if (
    Math.abs(
      metadata.width / metadata.height / (card.width / card.height) - 1,
    ) > 0.025
  )
    throw new Error('MASK_ASPECT_MISMATCH');
  const bytes = await sharp(input).removeAlpha().greyscale().png().toBuffer();
  await atomic(join(cardDirectory(store, card.id), `${kind}.mask.png`), bytes);
}
export async function assemble(store, card) {
  const directory = cardDirectory(store, card.id);
  const source = await sharp(join(directory, 'source.png'))
    .toColourspace('srgb').ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  const warnings = [];
  for (const kind of kinds) {
    const mask = await sharp(join(directory, `${kind}.mask.png`))
      .resize(width, height, { fit: 'fill' })
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer();
    const output = Buffer.from(source.data);
    let coverage = 0;
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const a = Math.max(0, Math.min(1, (mask[pixel] - 24) / 207));
      coverage += a;
      const i = pixel * 4;
      output[i + 3] = Math.round(a * source.data[i + 3]);
      if (kind === 'structure') output[i] = output[i + 1] = output[i + 2] = 255;
    }
    if (coverage < 1) warnings.push(`${kind.toUpperCase()}_EMPTY_SELECTION`);
    await atomic(
      join(directory, `${kind}.png`),
      await sharp(output, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
  }
  await atomic(
    join(directory, 'assembly.json'),
    JSON.stringify(
      {
        width,
        height,
        warnings,
        assembled_at: Date.now(),
        method: 'original_pixels_with_ai_selection_masks',
        repairs: false,
      },
      null,
      2,
    ),
  );
  return warnings;
}
export async function saveInput(store, id, original, normalized) {
  const dir = cardDirectory(store, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await atomic(join(dir, 'original'), original);
  await atomic(join(dir, 'source.png'), normalized);
}
export async function assemblyInfo(store, id) {
  try {
    return JSON.parse(
      await readFile(join(cardDirectory(store, id), 'assembly.json'), 'utf8'),
    );
  } catch {
    return null;
  }
}
