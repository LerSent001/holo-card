export const MODEL = 'gemini-3.1-flash-image';
export const prompts = {
  character:
    'The main illustrated character or main foreground subject. Select only its actually VISIBLE pixels, including its outline and internal colors. Exclude all printed text, icons, border, and scenery.',
  background:
    'Only the VISIBLE background scenery inside the illustration. Exclude the main character, all printed text, symbols, UI, border and foreground subject. Occluded areas must remain black. Do not imagine hidden scenery.',
  ui: 'All VISIBLE printed text, letters, numerals, labels, symbols, badges, layout rules and card frame/border. Select the precise visible glyphs and graphic shapes, not large rectangular text boxes. Exclude character and scenery.',
  structure:
    'Only the VISIBLE fine structural contour lines on the main illustrated character: outer contour and internal defining outlines of anatomy, armor, limbs, face and shape boundaries. Identify these by shape regardless of color. Draw thin white lines precisely on those existing contours. Do not select filled color regions, shading, text, UI, background lines, or the card frame. Do not invent or complete hidden contours.',
};
export function prompt(kind) {
  return `Create a pixel-aligned BLACK AND WHITE SELECTION MASK from the supplied card image. This is image segmentation, not a new drawing. Target: ${prompts[kind]}\nOutput exactly one image matching the ENTIRE input canvas, aspect ratio, positions and scale. WHITE (#FFFFFF) for selected pixels, BLACK (#000000) everywhere else. Thin antialiased gray edge pixels allowed. No colors, labels, checkerboards, shadows or decorative additions. Never shift, enlarge, crop, reconstruct, repair, extrapolate or fill occluded regions. Preserve the original composition exactly. If no target exists, return an all-black image.`;
}
export class ProviderFailure extends Error {
  constructor(code, { uncertain = false, retryable = false } = {}) {
    super(code);
    this.code = code;
    this.uncertain = uncertain;
    this.retryable = retryable;
  }
}
const api = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export class Gemini {
  constructor(key) {
    this.key = key;
    this.model = MODEL;
  }
  get configured() {
    return !!this.key;
  }
  headers() {
    return {
      'x-goog-api-key': this.key,
      'Content-Type': 'application/json',
      'Api-Revision': '2026-05-20',
    };
  }
  async submit(kind, source) {
    let response;
    try {
      response = await fetch(api, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: MODEL,
          background: true,
          store: true,
          input: [
            { type: 'text', text: prompt(kind) },
            {
              type: 'image',
              mime_type: 'image/png',
              data: source.toString('base64'),
            },
          ],
          response_format: {
            type: 'image',
            image_size: '1K',
            delivery: 'inline',
          },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new ProviderFailure('SUBMISSION_OUTCOME_UNKNOWN', {
        uncertain: true,
      });
    }
    if (!response.ok)
      throw new ProviderFailure(
        response.status === 429
          ? 'PROVIDER_QUOTA_OR_RATE_LIMIT'
          : response.status === 401 || response.status === 403
            ? 'PROVIDER_AUTH_OR_BILLING'
            : `PROVIDER_HTTP_${response.status}`,
        { uncertain: response.status >= 500 },
      );
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ProviderFailure('SUBMISSION_OUTCOME_UNKNOWN', {
        uncertain: true,
      });
    }
    if (!result.id)
      throw new ProviderFailure('SUBMISSION_OUTCOME_UNKNOWN', {
        uncertain: true,
      });
    return result;
  }
  async retrieve(id) {
    let response;
    try {
      response = await fetch(`${api}/${encodeURIComponent(id)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ProviderFailure('RESULT_READ_UNAVAILABLE', { retryable: true });
    }
    if (!response.ok)
      throw new ProviderFailure(
        response.status === 404 || response.status === 410
          ? 'PROVIDER_RESULT_EXPIRED'
          : `RESULT_HTTP_${response.status}`,
        { retryable: ![404, 410].includes(response.status) },
      );
    return response.json();
  }
}
export function imageFrom(result) {
  return [
    ...(result.steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? []),
    ...(result.outputs ?? []),
  ].find(
    (x) =>
      x.type === 'image' &&
      typeof x.data === 'string' &&
      x.mime_type?.startsWith('image/'),
  );
}
