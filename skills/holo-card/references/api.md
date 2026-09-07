# API connection and agent contract

The separately running **Holo Card API** is required. Its OpenAPI 3.1 document is served at `/openapi.json`. The skill works with localhost or a remote HTTPS deployment; it does not depend on the earlier Sites website or its browser login.

## Configure a client

Use a protected file supplied by the API operator. It can contain a plain API token or JSON with `api_token`:

```sh
python3 <skill-dir>/scripts/api.py configure --url https://YOUR_API_ORIGIN --token-file /private/path/token.json
```

Do not request that the user paste their Gemini key into chat. The Gemini key belongs only to the service process. Local configuration defaults to `~/.config/holo-card/client.json` (mode 600). Different agents can select different client files with `HOLO_CONFIG`.

If a local service installation exists, its non-secret paths live in `~/.config/holo-card/service.json`. The installer is in the separately distributed API package. Do not guess paths, install random dependencies, publish a website or expose a localhost port just to configure this skill.

## Direct calls for other agents

Use `Authorization: Bearer <API_TOKEN>` for all `/v1` endpoints. API tokens have `cards:read`, `cards:write` and/or `generations:create` scopes. Cards and jobs are isolated by token owner. Creating a new token defaults to a separate owner; the operator can explicitly give another token the same owner to share a library.

| Operation | Request | Result |
|---|---|---|
| Upload | `POST /v1/cards`, multipart `file`, optional `name` | Card ID and stored source, no generation |
| Start | `POST /v1/cards/{id}/generations`, `Idempotency-Key`, JSON `{"max_image_calls":4}` | Durable job ID, HTTP 202; same key replays the job |
| Progress | `GET /v1/jobs/{id}` | Actual layer states, timestamps, errors and completion count |
| Result | `GET /v1/cards/{id}` | Protected RGBA/mask asset URLs, ZIP and preview-link endpoint |
| Bundle | `GET /v1/cards/{id}/bundle` | Self-contained HTML and material ZIP |
| Preview | `POST /v1/cards/{id}/preview-links` | Scoped 15-minute browser URL |

Do not create a fresh idempotency key after a network timeout. Query the card for its existing job, or replay the original request with the **same** key. The server also enforces one job per card, so a different key cannot silently start another paid generation. A new upload followed by generation is new paid work and needs the user's authorization.

Important errors: `PROVIDER_NOT_CONFIGURED`, `PROVIDER_AUTH_OR_BILLING`, `PROVIDER_QUOTA_OR_RATE_LIMIT`, `SUBMISSION_OUTCOME_UNKNOWN`, `PROVIDER_NO_IMAGE`, `MASK_ASPECT_MISMATCH`, `ASSEMBLY_FAILED`. None justifies automatic paid retry. Read-only polling failures can recover on a later read.

The service normalizes image orientation and limits the longest edge to 1600 px without cropping; original uploaded bytes remain separately available. AI masks are resized to the normalized canvas only after an aspect-ratio check. RGBA colors come from this normalized source; hidden regions are not repaired. A successful generation response does not itself prove high-quality segmentation.

## API-only client workflow

This section is for agents without built-in image generation, or when the user explicitly requests API mode. Codex normally uses `native.py` and its built-in image tool instead.

```sh
python3 <skill-dir>/scripts/api.py doctor
python3 <skill-dir>/scripts/api.py upload /absolute/path/card.png
python3 <skill-dir>/scripts/api.py generate CARD_ID --max-image-calls 4
python3 <skill-dir>/scripts/api.py wait JOB_ID --timeout 50
python3 <skill-dir>/scripts/api.py download CARD_ID --output /absolute/path/card.zip --extract
python3 <skill-dir>/scripts/api.py preview CARD_ID
```

Before the `generate` command, require authorization for the supplied image and at most four 1K image calls. Reuse existing authorization; configuration, upload, or a refusal of a test image does not grant permission for paid generation. The client saves an idempotency key before submission. `wait` reports real states and returns within a bounded interval. A configured local API can be started using `service.py start`; this is never needed for native Codex mode.
