---
name: holo-card
description: Create interactive holographic cards from supplied images with colored layers, repaired scenery, signed parallax and contour glow. Use Codex native image tools with local assembly, or an explicitly selected independent API workflow.
---

# Holo Card

## Execution paths

**Codex default:** built-in image tool → inspect/repair layers → local `native.py` assembly. No API key, server or paid API request is required. Never run API setup as a prerequisite.

**Independent API mode:** for agents without native image tools or an explicitly selected API workflow, read [API instructions](references/api.md). The included service currently uses legacy four-mask extraction without hidden-region repair. Do not claim native/API visual parity.

A safety refusal is not a missing-alpha error. Preserve the actual refusal and stop that generation; never rewrite prompts or switch providers to bypass it. API mode is not a workaround for a blocked image. For apparent false positives, use the provider's support process or different permitted material. API failures and uncertain submissions must not trigger automatic paid retries.

## Native workflow

1. Inspect the actual supplied image with `view_image`. Do not identify/name illustrated characters unless needed. Do not substitute an example.
2. Prepare a persistent job:

```sh
python3 <skill-dir>/scripts/native.py prepare --source /absolute/card.png --output /absolute/new-job --name 'Holo Card'
```

The helper requires Pillow. It saves the original, normalized source, state and prompts without network access. Read `prompts.json` before generation.

3. Generate separate **colored** layers with the built-in image tool:
   - **Character:** continuous colored foreground, preserving clothing, anatomy and dark details. Remove overlaid text and repair the concealed artwork coherently. Keep genuine alpha outside the silhouette.
   - **Background:** identify scenery and reconstruct every area hidden by subjects, typography and frame. Produce a complete opaque plate, without holes, glyphs or frame fragments, with room for moving crops.
   - **UI:** combine original text, numbers, symbols, panels and the entire decorative frame at one depth. Preserve glyphs, colors and layout. Transparent outside actual UI shapes.
   - **Structure:** derive thin white structural contours on black from the final repaired character layer, on exactly the same canvas. No filled regions, text, frame or scenery.

Use the source card for the first three layers and the final character for contours. Preserve canvas, position and scale; do not independently recenter or fit layers. Inpainting is inferred repair, not recovery of unknown original pixels. The first three layers stay colored; only structure is a luminance mask.

4. Inspect and import each actual returned image:

```sh
python3 <skill-dir>/scripts/native.py add --job /absolute/job --kind character --image /actual/output.png --tool-reference 'Actual generation or repair record'
```

Repeat for `background`, `ui`, and `structure`. Raw inputs and hashes are retained. Use `--replace` only for an authorized replacement. Aspect errors require review, not silent cropping.

5. Assemble, inspect, and deliver:

```sh
python3 <skill-dir>/scripts/native.py assemble --job /absolute/job
python3 <skill-dir>/scripts/native.py status --job /absolute/job
```

Outputs include four RGBA assets, self-contained HTML, ZIP and provenance. Assembly completion is not visual approval. Inspect actual results before claiming fidelity. No automatic publishing is performed.

## Alpha repair: affected regions only

Use correctly transparent layers directly. Never generate full-element masks as a default fallback.

If a colored output contains baked checkerboard pixels, first verify the artwork is otherwise usable. Identify only the contaminated background regions and remove that checkerboard locally, preserving existing valid alpha, clothing, skin, white highlights, text and frame. Never globally erase gray/white colors or derive subject alpha from artwork brightness. Use small auxiliary selections only where contamination is ambiguous. Check black and white composites; repair edge RGB contamination as well as alpha. Local repair cannot fix changed pose or layout.

An optional helper applies an independently prepared, aligned grayscale correction mask without altering RGB. It does **not** predict masks or remove checkerboards automatically:

```sh
python3 <skill-dir>/scripts/native.py apply-alpha --job /absolute/job --kind character --color /absolute/color.png --mask /absolute/correction.png --tool-reference 'Exact local correction method'
```

The mask must match image dimensions, use L/1 mode and contain opaque/transparent coverage. Supply the complete desired alpha with unaffected areas preserved. The helper saves input hashes and black/white review images. For UI, retain original colored pixels where possible rather than regenerating typography. Do not use alpha repair to bypass a refused generation.

## Rendering contract

- English controls: **Depth** and **Contour glow**. Depth defaults to 0 at the midpoint of -3…+3; no left/right direction captions.
- Signed depth changes foreground parallax: negative inward, positive outward. It NEVER changes stacking: **background → character → combined text/frame UI** at every value. UI also occludes emission and bloom.
- Background moves independently with view, including when depth is 0. Reference mapping: `b=(p-.5)*.5+.5-view*.25` (2× background crop). Foreground and its contour use the same coordinates.
- Use supplied decorative frame; do not overlay an invented procedural rim. Preserve HDR/RGBM bloom and backside isolation. Default contour glow is 0.15; zero disables contour light without removing foil lighting.
- Check -3, 0 and +3 at the same tilted view, glow zero/modest, black/white alpha composites, and front/back. Reject holes, checkerboard residue, doubled/moving text, misaligned anatomy and contour drift. Do not hide defects under bloom.

## Local browser preview

Serve the output folder on loopback with a persistent static server and open its real `http://127.0.0.1:PORT/index.html` URL. Inspect the browser and retain the preview tab. A queued file panel does not prove a browser loaded. This does not authorize public website deployment.

## Attribution

Creative inspiration: **@乌托邦的香蕉**, using the same name on **Xiaohongshu (小红书)** and **Bilibili (B站)**. This acknowledges inspiration, not authorship of this implementation or endorsement. No profile URL is asserted without verification.

- Contour glow is restricted to the structural line coverage multiplied by foreground alpha and UI exclusion. Mask the final blurred bloom by that same line coverage; no halo may spill into scenery or flat subject interiors. Compare glow 0 and maximum at a fixed view; only contour-covered pixels may change. Background foil lighting is independent.

## Phone preview

Every generated viewer supports optional device orientation, touch drag, tap-to-flip and Recenter. Motion starts only after the viewer clicks Enable motion; iOS permission is requested inside that gesture. HTTPS is required. Drag temporarily overrides motion. Each device keeps its own depth and glow values; no synchronization service is used. Verify permission denial, missing sensors, calibration and screen rotation separately from actual phone sensor testing.

When the user requests a phone-accessible preview, host the generated HTML on an authorized HTTPS destination. With its exact URL, add an offline QR entry using the optional `qrcode` Python dependency:

```sh
python3 <skill-dir>/scripts/native.py assemble --job /absolute/job --preview-url https://actual-host.example/card
```

Publish the updated HTML containing the QR entry to that same URL. This argument generates a link and QR only; it does not upload or establish availability. Preserve the target access policy and state if the link requires login. Do not claim real phone verification from synthetic orientation events.
