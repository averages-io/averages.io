/**
 * Client-side image screening for user uploads (profile photos + wallpapers),
 * using NSFWJS with a SELF-HOSTED model.
 *
 * Self-hosting is deliberate, not incidental:
 *   - NSFWJS's own README warns the CDN-hosted model has moved/been pulled
 *     because of hotlinkers, so depending on it would mean the filter silently
 *     stops working one day.
 *   - The model files ship in this repo under public/models/mobilenet_v2/ and
 *     are served from the app's own origin, so screening keeps working with no
 *     third-party dependency at runtime.
 *
 * The scan runs entirely in the user's browser. The image is never uploaded
 * anywhere to be checked — which matters for a privacy policy that promises
 * academic data never leaves the device, and means the filter costs nothing
 * to run per user.
 */

export interface ScanVerdict {
  allowed: boolean;
  /** Why it was blocked, phrased for a person, not a log line. */
  reason?: string;
  /** Raw class probabilities, useful for tuning thresholds later. */
  scores?: Record<string, number>;
}

/**
 * Blocking thresholds.
 *
 * Porn/Hentai are near-unambiguous, so they trip at a moderate confidence.
 * "Sexy" is the fuzzy one — NSFWJS applies it to swimwear, gym photos and
 * plenty of ordinary beach wallpapers — so it needs a much higher bar before
 * blocking, or the filter starts rejecting a picture of someone's summer
 * vacation.
 */
const EXPLICIT_THRESHOLD = 0.5; // Porn + Hentai, combined
const SUGGESTIVE_THRESHOLD = 0.8; // Sexy, alone

/**
 * What to do when the model itself can't run (no WebGL, blocked download,
 * ancient browser).
 *
 * Fail CLOSED: an upload that couldn't be screened is refused rather than
 * waved through. Failing open would mean anyone who wants to bypass the filter
 * just has to break the model load, which defeats having one. The user gets a
 * clear "couldn't check this right now" message rather than a silent rejection.
 */
const FAIL_CLOSED = true;

const MODEL_PATH = "/models/mobilenet_v2/";
const MODEL_CACHE_KEY = "indexeddb://schoolagy-nsfw-mobilenet-v2";

type NsfwModel = {
  classify: (
    img: HTMLImageElement | HTMLCanvasElement,
    topK?: number
  ) => Promise<{ className: string; probability: number }[]>;
};

let modelPromise: Promise<NsfwModel> | null = null;

/**
 * Loads the model once per page session, preferring an IndexedDB copy.
 *
 * First visit pays the ~2.6MB download; after that it's read from IndexedDB,
 * so the upload gate opens fast on every later use.
 */
async function loadModel(): Promise<NsfwModel> {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const [nsfwjs, tf] = await Promise.all([
      import("nsfwjs"),
      import("@tensorflow/tfjs"),
    ]);

    await tf.ready();

    try {
      // Cached copy from a previous visit.
      return (await nsfwjs.load(MODEL_CACHE_KEY as any)) as unknown as NsfwModel;
    } catch {
      // Not cached yet (or the cache is stale/corrupt) — fetch the real files
      // and save them for next time. A failure to SAVE must not fail the load;
      // the model is already usable in memory at that point.
      const model = (await nsfwjs.load(MODEL_PATH)) as any;
      try {
        await model.model.save(MODEL_CACHE_KEY);
      } catch {
        /* caching is an optimization, not a requirement */
      }
      return model as NsfwModel;
    }
  })();

  // Don't let one failed load poison every later attempt — a transient network
  // failure should be retryable on the next upload.
  modelPromise.catch(() => {
    modelPromise = null;
  });

  return modelPromise;
}

/** Warms the model in the background so the first real scan isn't the slow one. */
export function preloadNsfwModel(): void {
  loadModel().catch(() => {
    /* preloading is best-effort */
  });
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode_failed"));
    };
    img.src = url;
  });
}

/**
 * Screens one image file.
 *
 * Note on animated GIFs (allowed for profile photos): an <img> only exposes
 * the first frame to canvas/TensorFlow, so that's what gets classified. A GIF
 * whose later frames differ from its first would pass on the strength of frame
 * one. Decoding every frame client-side needs a full GIF decoder; if that
 * matters later, the honest fix is server-side screening on upload rather than
 * pretending this covers it.
 */
export async function scanImage(file: File): Promise<ScanVerdict> {
  let model: NsfwModel;
  try {
    model = await loadModel();
  } catch {
    return FAIL_CLOSED
      ? {
          allowed: false,
          reason:
            "We couldn't run the image check just now. Please check your connection and try again.",
        }
      : { allowed: true };
  }

  let img: HTMLImageElement;
  try {
    img = await fileToImage(file);
  } catch {
    return {
      allowed: false,
      reason: "That image couldn't be read — it may be corrupted.",
    };
  }

  try {
    const predictions = await model.classify(img);
    const scores: Record<string, number> = {};
    for (const p of predictions) scores[p.className] = p.probability;

    const explicit = (scores.Porn ?? 0) + (scores.Hentai ?? 0);
    const suggestive = scores.Sexy ?? 0;

    if (explicit >= EXPLICIT_THRESHOLD) {
      return {
        allowed: false,
        reason: "That image looks like it contains explicit content, so it can't be used here.",
        scores,
      };
    }
    if (suggestive >= SUGGESTIVE_THRESHOLD) {
      return {
        allowed: false,
        reason: "That image looks too suggestive to use here — try a different one.",
        scores,
      };
    }

    return { allowed: true, scores };
  } catch {
    return FAIL_CLOSED
      ? {
          allowed: false,
          reason: "We couldn't check that image. Please try a different one.",
        }
      : { allowed: true };
  }
}

/**
 * Installs the scanner as a global the ported legacy pages call.
 *
 * onboarding.html and settings.html already ship a complete upload gate —
 * consent pane, scanning pane, error pane — whose scan step was a
 * `setTimeout(..., 1400) // mock scan delay` placeholder. The build replaces
 * that placeholder with a call to this global, so the real check lands inside
 * the UI that was already designed for it, and no page markup changed.
 */
export function installNsfwGlobal(): void {
  if (typeof window === "undefined") return;
  (window as any).__averagesScanImage = scanImage;
}
