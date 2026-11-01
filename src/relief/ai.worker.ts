/// <reference lib="webworker" />
/**
 * Runs the in-browser photo models off the main thread.
 *   depth  -> Depth Anything V2 Small (relative depth, Apache-2.0)
 *   cutout -> RMBG-1.4 background removal (non-commercial licence)
 * Models download from the Hugging Face Hub on first use and are cached by the browser.
 */
import type { AiRequest, AiResponse } from './ai';

type Transformers = typeof import('@huggingface/transformers');
type Device = 'webgpu' | 'wasm';

let lib: Promise<Transformers> | null = null;
const pipelines = new Map<string, Promise<unknown>>();

const post = (msg: AiResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

async function transformers() {
  lib ??= import('@huggingface/transformers');
  return lib;
}

function hasWebGpu() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as unknown as { gpu?: unknown }).gpu;
}

function progressReporter(id: string, label: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: unknown) => {
    const info = p as { status?: string; file?: string; loaded?: number; total?: number; progress?: number };
    if (info.status === 'progress' && info.file) {
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      const mb = (n: number) => (n / 1048576).toFixed(0);
      post({ id, kind: 'progress', progress: total ? Math.min(99, Math.round((loaded / total) * 100)) : 1, status: `${label}: downloading model, ${mb(loaded)} of ${mb(total)} MB (one time, cached by the browser)` });
    } else if (info.status === 'ready') {
      post({ id, kind: 'progress', progress: 99, status: `${label}: model ready, running…` });
    }
  };
}

async function getPipeline(task: 'depth-estimation' | 'background-removal', model: string, device: Device, dtype: string, id: string, label: string) {
  const key = `${task}|${model}|${device}|${dtype}`;
  if (!pipelines.has(key)) {
    const tf = await transformers();
    const p = (tf.pipeline as unknown as (t: string, m: string, o: Record<string, unknown>) => Promise<unknown>)(task, model, {
      device,
      dtype,
      progress_callback: progressReporter(id, label)
    });
    pipelines.set(key, p);
    p.catch(() => pipelines.delete(key));
  }
  return pipelines.get(key)!;
}

async function runDepth(id: string, blob: Blob, model: string) {
  const tf = await transformers();
  const image = await tf.RawImage.fromBlob(blob);
  const attempts: { device: Device; dtype: string }[] = hasWebGpu()
    ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastError: unknown = null;
  for (const a of attempts) {
    try {
      const pipe = await getPipeline('depth-estimation', model, a.device, a.dtype, id, 'Depth') as (img: unknown) => Promise<{ predicted_depth: { dims: number[]; data: ArrayLike<number> } }>;
      post({ id, kind: 'progress', progress: 99, status: `Depth: running on ${a.device}…` });
      const out = await pipe(image);
      const [h, w] = out.predicted_depth.dims.slice(-2);
      const values = Float32Array.from(out.predicted_depth.data);
      let finite = 0, min = Infinity, max = -Infinity;
      for (const v of values) if (Number.isFinite(v)) { finite++; if (v < min) min = v; if (v > max) max = v; }
      if (finite < values.length * 0.99 || !(max > min)) throw new Error(`Depth output unusable on ${a.device}/${a.dtype}`);
      post({ id, kind: 'depth', width: w, height: h, values, device: a.device }, [values.buffer]);
      return;
    } catch (err) {
      lastError = err;
      post({ id, kind: 'progress', progress: 1, status: `Depth on ${a.device}/${a.dtype} failed (${(err as Error).message ?? err}); trying the next option…` });
    }
  }
  throw lastError ?? new Error('Depth estimation failed.');
}

async function runCutout(id: string, blob: Blob, model: string) {
  const tf = await transformers();
  const image = await tf.RawImage.fromBlob(blob);
  const attempts: { device: Device; dtype: string }[] = hasWebGpu()
    ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  let lastError: unknown = null;
  for (const a of attempts) {
    try {
      const pipe = await getPipeline('background-removal', model, a.device, a.dtype, id, 'Cutout') as (img: unknown) => Promise<{ width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray }>;
      post({ id, kind: 'progress', progress: 99, status: `Cutout: running on ${a.device}…` });
      const out = await pipe(image);
      const n = out.width * out.height;
      const alpha = new Uint8Array(n);
      if (out.channels === 4) for (let i = 0; i < n; i++) alpha[i] = out.data[i * 4 + 3];
      else if (out.channels === 1) for (let i = 0; i < n; i++) alpha[i] = out.data[i];
      else throw new Error(`Unexpected cutout output with ${out.channels} channels`);
      let on = 0;
      for (const v of alpha) if (v > 127) on++;
      if (on === 0 || on === n) throw new Error('Cutout returned an empty mask');
      post({ id, kind: 'cutout', width: out.width, height: out.height, alpha, device: a.device }, [alpha.buffer]);
      return;
    } catch (err) {
      lastError = err;
      post({ id, kind: 'progress', progress: 1, status: `Cutout on ${a.device}/${a.dtype} failed (${(err as Error).message ?? err}); trying the next option…` });
    }
  }
  throw lastError ?? new Error('Background removal failed.');
}

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'depth') await runDepth(req.id, req.blob, req.model);
    else if (req.kind === 'cutout') await runCutout(req.id, req.blob, req.model);
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
