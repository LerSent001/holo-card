# Holo Card

A Codex skill and optional local API service for turning supplied artwork into interactive holographic cards with foreground parallax, a moving background, and adjustable contour glow.

**Creative inspiration: @乌托邦的香蕉 — the same handle on Xiaohongshu (小红书) and Bilibili (B站).** This project is an independent implementation; attribution does not imply endorsement.

## Install the skill

Download the release ZIP, or clone this repository:

```sh
git clone https://github.com/LerSent001/holo-card.git
mkdir -p ~/.codex/skills
cp -R holo-card/skills/holo-card ~/.codex/skills/holo-card
python3 -m pip install Pillow
```

If that skill directory already exists, back it up or deliberately replace it. Start a fresh Codex task after installation. Attach your image and ask:

```text
$holo-card Turn this image into an interactive holographic card.
```

Codex uses its built-in image tool; no Gemini key or API server is required. The runtime must provide image generation, Python/Pillow, filesystem access and a browser preview. Availability depends on your Codex environment.

## What happens

1. Save the original and normalize orientation without cropping.
2. Generate a continuous colored foreground, repairing artwork hidden by lettering.
3. Reconstruct a complete opaque background, including areas hidden by the foreground and border.
4. Extract text, symbols and the decorative frame together as one colored UI layer.
5. Inspect true transparency. Repair only actual baked-checkerboard regions when necessary; do not mask every element or erase white artwork globally.
6. Generate aligned structural contours, assemble an offline HTML card and ZIP, and inspect the result in a local browser.

The local helper does not generate or segment images by itself. It saves jobs, validates/imports layers, optionally applies a supplied alpha correction and assembles them. Source pixels hidden by overlays cannot be recovered exactly; inpainting is an approximation. Generated lettering, shape alignment and alpha edges still need visual review.

## Controls

- Drag to rotate; click or press Enter/Space to flip.
- Arrow keys adjust the card angle.
- **Depth:** -3 to +3, default 0 at the center. Negative/positive changes foreground parallax direction. Text and frame always remain above the foreground.
- **Contour glow:** 0 to 3, default 0.15. Zero disables contour light.
- Background texture moves independently of the card's CSS rotation.

## Local commands

```sh
python3 skills/holo-card/scripts/native.py prepare --source /path/card.png --output /path/new-job --name 'My Card'
# Use the native image tool, inspect its outputs, then import each layer:
python3 skills/holo-card/scripts/native.py add --job /path/new-job --kind character --image /path/character.png
# Repeat for background, ui and structure.
python3 skills/holo-card/scripts/native.py assemble --job /path/new-job
python3 -m http.server 8795 --bind 127.0.0.1 --directory /path/new-job
```

Open the loopback URL printed by your server. `index.html` is also self-contained for offline use. `card.zip` contains the HTML, layers and provenance. Use `status --job ...` to resume a saved job. Successful assembly is not proof of visual fidelity.

## Edge cases

| Situation | Handling |
| --- | --- |
| Native image safety refusal | Stop the refused generation and record the error. Do not rephrase or switch providers to bypass it. Contact provider support for an apparent false positive, or use different permitted material. |
| No native image capability | An independently selected API workflow is available; see below. This is not a safety-refusal bypass. |
| Baked checkerboard instead of Alpha | Inspect alpha values, then clean only confirmed contaminated background regions. Protect white clothing, highlights and glyphs. Local code does not automatically solve this. |
| Existing valid transparency | Preserve it; no additional full-element mask is needed. |
| Text overlaps foreground | Remove it from the foreground and repair underlying artwork. Keep typography only in the combined UI layer. |
| Frame and text overlap | Keep both in one UI layer, above the foreground at every depth. |
| Missing background | Inpaint the full opaque plate before parallax. No holes or retained glyphs. |
| Layer moved or changed scale | Align explicitly or reject it. Do not silently crop/stretch or claim an exact extraction. |
| Glow obscures details | Reduce glow and inspect without emission; fix alignment rather than hiding defects. |
| Paid API timeout or uncertain submission | Reuse the existing idempotency key and inspect status. Never automatically start another paid job. |

## Optional API service

[API setup](packages/holo-card-api/README.md) · [Agent/client workflow](skills/holo-card/references/api.md) · [OpenAPI](packages/holo-card-api/openapi.json)

The service requires Node.js 24+, pnpm, a provider key and explicit paid-call authorization. Keep keys in private local files, not chat or generated artifacts. Configuration and upload do not start generation. It binds to loopback by default; no hosted endpoint is supplied.

**Current limitation:** the API uses legacy four-mask extraction and does not implement the native colored-layer inpainting workflow. Its tests use a mock provider; they do not prove live provider availability, billing, or visual quality. Do not treat it as an automatic fallback for a native refusal.

## Verification

```sh
python3 -m unittest discover -s skills/holo-card/tests
cd packages/holo-card-api
pnpm install --frozen-lockfile
node --test test/*.test.mjs
```

## Scope and rights

The package contains code and an original geometric card back. User images, generated example cards, credentials, caches and job histories are excluded. Use artwork you are entitled to process and share. This is a layered 2D parallax renderer, not reconstructed 3D geometry. The project is provided under the MIT license; third-party dependencies retain their own licenses.
