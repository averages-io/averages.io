/**
 * The image check's model, run in a Web Worker (2026-10-05).
 *
 * Why a worker: loading TensorFlow and warming the model compiles its GPU
 * programs, which used to freeze Settings and Onboarding for several seconds
 * right after they opened (no clicks, no scrolling), worst on Chromebooks.
 * Here that work happens on its own thread; the page stays responsive.
 *
 * Messages in:  {id, type: "warm"} | {id, type: "scan", width, height, pixels: ArrayBuffer (RGBA)}
 * Messages out: {id, ok: true, predictions?} | {id, ok: false}
 * Same model, same files, same IndexedDB cache key as the old in-page code.
 */
import * as tf from "@tensorflow/tfjs";
import * as nsfwjs from "nsfwjs";

const MODEL_PATH = "/models/mobilenet_v2/";
const MODEL_CACHE_KEY = "indexeddb://schoolagy-nsfw-mobilenet-v2";

type Model = { classify: (img: ImageData | tf.Tensor3D, topK?: number) => Promise<{ className: string; probability: number }[]> };

let modelPromise: Promise<Model> | null = null;

function loadModel(): Promise<Model> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    // WebGL in a worker needs OffscreenCanvas; without it the CPU backend
    // still works, just slower (and still off the page's thread).
    let ok = false;
    try {
      if (typeof OffscreenCanvas !== "undefined") ok = await tf.setBackend("webgl");
    } catch {
      ok = false;
    }
    if (!ok) await tf.setBackend("cpu");
    await tf.ready();
    try {
      return (await nsfwjs.load(MODEL_CACHE_KEY as any)) as unknown as Model;
    } catch {
      const model = (await nsfwjs.load(new URL(MODEL_PATH, self.location.origin).href)) as any;
      try {
        await model.model.save(MODEL_CACHE_KEY);
      } catch {
        /* caching is an optimization */
      }
      return model as Model;
    }
  })();
  modelPromise.catch(() => {
    modelPromise = null;
  });
  return modelPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    const model = await loadModel();
    if (msg.type === "warm") {
      (self as any).postMessage({ id, ok: true });
      return;
    }
    if (msg.type !== "scan") throw new Error("unknown_message");
    const width = Number(msg.width), height = Number(msg.height);
    if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096) || !(msg.pixels instanceof ArrayBuffer) || msg.pixels.byteLength !== width * height * 4) {
      throw new Error("bad_image");
    }
    const image = new ImageData(new Uint8ClampedArray(msg.pixels), width, height);
    const predictions = await model.classify(image);
    (self as any).postMessage({ id, ok: true, predictions: predictions.map((p) => ({ className: String(p.className), probability: Number(p.probability) })) });
  } catch {
    (self as any).postMessage({ id, ok: false });
  }
};
