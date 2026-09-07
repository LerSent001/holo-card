# Holo Card API

Standalone Node.js service for agents without built-in image generation. Codex defaults to its built-in image tool plus the skill’s local native.py assembler; it does not need this service or its credentials. It does not use the Sites website, browser login, D1 or R2. SQLite and image files stay in a configurable private data directory.

## Run locally

Requires Node.js 24+ and pnpm. Install the pinned dependency with `pnpm install --frozen-lockfile` in this directory.

```sh
python3 scripts/install-local.py --node /absolute/path/to/node \
  --gemini-env-file /private/path/service.env \
  --skill-source /absolute/path/to/skills/holo-card
python3 ~/.codex/skills/holo-card/scripts/service.py start
python3 ~/.codex/skills/holo-card/scripts/api.py doctor
```

The private env file contains `GEMINI_API_KEY=...`. Installation saves it outside the skill, creates a scoped API token in a mode-600 client file, and installs the skill if requested. No paid generation is started. Existing skills are never silently replaced. Configuration defaults to `~/.config/holo-card`, data to `~/.local/share/holo-card`, and the service binds only to `127.0.0.1:8787`.

The helper starts a detached local process; it does not register automatic startup at login. Restart it with `service.py start` after a reboot. SQLite preserves jobs; accepted Gemini IDs resume without resubmission. During a crash with an unknown POST outcome, that layer remains uncertain and is not automatically billed again.

## Direct agent API

Read `openapi.json` or GET `/openapi.json` for the complete OpenAPI 3.1 contract. `/v1` requires `Authorization: Bearer <API_TOKEN>`. Do not use a Gemini key as this token.

1. `POST /v1/cards` with multipart `file` and optional `name`. This only uploads.
2. `POST /v1/cards/{id}/generations` with JSON `{"max_image_calls":4}` and a persistent `Idempotency-Key`. HTTP 202 returns a job immediately.
3. `GET /v1/jobs/{id}` reads actual layer status and counts. The worker proceeds independently of clients.
4. `GET /v1/cards/{id}` supplies result endpoints. Download `/bundle` or create a short-lived link with `POST /preview-links`.

One generation job is accepted per card. Reusing a key returns the same job; another key cannot start a second job. Uploading a new card and generating it is new paid work. Failed/uncertain layers are never automatically resubmitted.

## Tokens and remote deployments

Offline administration runs against the same data directory:

```sh
node src/admin.mjs token-create --name other-agent --output /private/path/agent.json
node src/admin.mjs tokens
node src/admin.mjs token-revoke --id TOKEN_ID
```

A new token gets a separate owner by default. Use `--owner EXISTING_OWNER_ID` explicitly to share an existing card library. `--scopes cards:read` creates a read-only token. Plain credentials are written only to the requested protected file; SQLite stores their hashes.

For a remote deployment, run one service instance with durable local storage and a TLS reverse proxy. Set `HOLO_DATA_DIR`, `GEMINI_API_KEY`, `HOLO_PUBLIC_BASE_URL=https://your-api.example`, `HOST=0.0.0.0`, and `PORT`. Use the same token administration command on that server. Node startup can use `node --env-file=/private/path/service.env src/server.mjs`. Nothing in the local installer opens a remote port, publishes a website or configures a domain. Remote hosting has not been provisioned by this implementation.

## Material contract

The original upload is preserved byte-for-byte. The generation source is EXIF-oriented and downscaled only when its longest edge exceeds 1600 px, without cropping. Four 1K AI selection masks identify character, visible background, printed UI and structural contours. Aspect mismatch above 2.5% fails that layer instead of silently cropping it. RGBA colors come from the normalized source, with masks supplying alpha; hidden regions are not repaired. Structural pixels are white with alpha for shader emission.

The result ZIP includes an offline self-contained `index.html`, PNG materials/masks and provenance. The renderer keeps the existing HDR emission 40, RGBM range 64, two bloom scales, drag/flip, and explicit backside isolation. Card backs use the bundled original geometric artwork; see `THIRD_PARTY_NOTICES.md`.

Preview links expire after 15 minutes and authorize only one card. API keys never enter output files. The same files remain available through token-authenticated asset endpoints.

## Validation boundaries

`node --test test/*.test.mjs` exercises HTTP authentication, scope/revocation, upload decoding, original-byte fidelity, paid request deduplication, independent worker progression, restart recovery, RGBA extraction, ZIP output and scoped previews using an in-process mock provider. These tests do not make Gemini calls or prove visual segmentation quality. Live paid generation is reserved for the user's supplied image; no calibration-image generation is authorized.

Provider references: [image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Interactions API](https://ai.google.dev/api/interactions-api). API output must be inspected before claiming visual fidelity or measured generation time.
