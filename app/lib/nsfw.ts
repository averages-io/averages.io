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
 *
 * Since 2026-10-05 the model runs in a Web Worker (nsfw.worker.ts). Loading
 * TensorFlow and warming the model in the page itself froze Settings and
 * Onboarding for several seconds after they opened (Martin: "the website just
 * locks up and won't let you click anything for a good 4 secs"). The page now
 * only decodes the picture and hands the pixels over. Browsers that can't run
 * the worker fall back to the old in-page check, loaded only when a picture is
 * actually picked, never in the background.
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

/* ── The worker ─────────────────────────────────────────────────────── */

type WorkerReply = { id?: number; ok: boolean; predictions?: { className: string; probability: number }[]; crashed?: boolean };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 0;
const waiting = new Map<number, (reply: WorkerReply) => void>();

function getWorker(): Worker | null {
  if (workerBroken || typeof window === "undefined" || typeof Worker === "undefined" || typeof ImageData === "undefined") return null;
  if (worker) return worker;
  try {
    // A classic worker: Next (Turbopack) loads the worker's code with importScripts.
    worker = new Worker(new URL("./nsfw.worker.ts", import.meta.url));
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const done = reply && typeof reply.id === "number" ? waiting.get(reply.id) : undefined;
    if (!done) return;
    waiting.delete(reply.id as number);
    done(reply);
  };
  // The worker couldn't start or died: everything waiting falls back to the in-page check.
  worker.onerror = () => {
    workerBroken = true;
    for (const done of waiting.values()) done({ ok: false, crashed: true });
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Asks the worker; null when there's no worker to ask (use the in-page check). */
function askWorker(message: Record<string, unknown>, transfer: Transferable[] = [], timeoutMs = 90_000): Promise<WorkerReply | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++nextId;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      resolve({ ok: false });
    }, timeoutMs);
    waiting.set(id, (reply) => {
      window.clearTimeout(timer);
      resolve(reply);
    });
    try {
      w.postMessage({ ...message, id }, transfer);
    } catch {
      waiting.delete(id);
      window.clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Warms the model so the first real scan isn't the slow one. Only in the
 * worker: with no worker, warming would freeze the page, so the in-page check
 * waits until a picture is actually picked.
 */
export function preloadNsfwModel(): void {
  askWorker({ type: "warm" }).catch(() => {
    /* preloading is best-effort */
  });
}

/** Longest side handed to the model (it looks at 224 x 224 anyway). */
const MAX_SIDE = 512;

/** The picture, decoded and scaled down to MAX_SIDE, as a canvas. */
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement;
  let width: number;
  let height: number;
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file); // decoded off the page's thread where the browser can
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    const img = await fileToImage(file);
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
  }
  if (!width || !height) throw new Error("decode_failed");
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("decode_failed");
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in source && typeof source.close === "function") source.close();
  return canvas;
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
  let canvas: HTMLCanvasElement;
  try {
    canvas = await fileToCanvas(file);
  } catch {
    return {
      allowed: false,
      reason: "That image couldn't be read. It may be damaged.",
    };
  }

  let predictions: { className: string; probability: number }[];
  try {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const reply = await askWorker(
      { type: "scan", width: pixels.width, height: pixels.height, pixels: pixels.data.buffer },
      [pixels.data.buffer]
    );
    if (reply && reply.ok && Array.isArray(reply.predictions)) {
      predictions = reply.predictions;
    } else if (reply && !reply.crashed) {
      throw new Error("scan_failed");
    } else {
      // No worker (or it couldn't start): the in-page check, loaded now that it's needed.
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
      predictions = await model.classify(canvas);
    }
  } catch {
    return FAIL_CLOSED
      ? {
          allowed: false,
          reason: "We couldn't check that image. Please try a different one.",
        }
      : { allowed: true };
  }

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
      reason: "That image looks too suggestive to use here. Try a different one.",
      scores,
    };
  }

  return { allowed: true, scores };
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
