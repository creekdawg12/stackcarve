/// <reference lib="webworker" />
/**
 * Runs the in-browser photo models off the main thread.
 *   depth  -> Depth Anything V2 Small (relative depth, Apache-2.0)
 *   cutout -> RMBG-1.4 background removal (non-commercial licence)
 * Models download from the Hugging Face Hub on first use and are cached by the browser.
 */
import type { AiRequest, AiResponse, CutoutSpec } from './ai';
const PROTOCOL = 3;

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
    if (info.status === 'initiate' && info.file) post({ id, kind: 'progress', progress: 1, status: `${label}: looking for ${info.file} in the browser cache…` });
    else if (info.status === 'download' && info.file) post({ id, kind: 'progress', progress: 1, status: `${label}: downloading ${info.file}…` });
    else if (info.status === 'done' && info.file) post({ id, kind: 'progress', progress: 50, status: `${label}: ${info.file} ready` });
    else if (info.status === 'progress' && info.file) {
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

function deviceOrder(preferCpu: boolean): { device: Device; dtype: string }[] {
  const gpu: { device: Device; dtype: string }[] = hasWebGpu() ? [{ device: 'webgpu', dtype: 'fp16' }, { device: 'webgpu', dtype: 'fp32' }] : [];
  const cpu: { device: Device; dtype: string }[] = [{ device: 'wasm', dtype: 'q8' }];
  return preferCpu ? [...cpu, ...gpu] : [...gpu, ...cpu];
}

async function loadLibrary(id: string) {
  post({ id, kind: 'progress', progress: 1, status: 'AI worker started; loading the model library…' });
  const tf = await transformers();
  post({ id, kind: 'progress', progress: 1, status: 'Model library loaded; decoding the photo…' });
  return tf;
}

async function runDepth(id: string, blob: Blob, model: string, preferCpu: boolean) {
  const tf = await loadLibrary(id);
  const image = await tf.RawImage.fromBlob(blob);
  post({ id, kind: 'progress', progress: 1, status: 'Photo decoded; loading the depth model…' });
  const attempts = deviceOrder(preferCpu);
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

/** Load-time failures mean the candidate model is unusable here; move to the next model, not the next device. */
function isLoadFailure(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  return /not found|404|Unsupported model type|Could not locate|Unauthorized|401|403|No `image_processor_type`|Unknown image_processor_type|Failed to fetch|NetworkError|Load failed/i.test(msg);
}

const RMBG_PROCESSOR = {
  do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
  image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255,
  size: { width: 1024, height: 1024 }
};

/**
 * Matting models whose config.json declares a type this library does not know (RMBG-1.4):
 * load the weights as a generic encoder, run them by hand, and read the single-channel matte.
 */
async function runMattingManual(id: string, image: unknown, device: Device, dtype: string, reqId: string, label: string, size: number) {
  const tf = await transformers();
  const key = `manual|${id}|${device}|${dtype}`;
  if (!pipelines.has(key)) {
    const p = (async () => {
      const model = await (tf.AutoModel as unknown as { from_pretrained: (m: string, o: Record<string, unknown>) => Promise<unknown> })
        .from_pretrained(id, { config: { model_type: 'modnet' }, device, dtype, progress_callback: progressReporter(reqId, label) });
      let processor: unknown;
      try {
        processor = await (tf.AutoImageProcessor as unknown as { from_pretrained: (m: string, o: Record<string, unknown>) => Promise<unknown> }).from_pretrained(id, {});
      } catch {
        processor = new (tf.ImageProcessor as unknown as new (c: Record<string, unknown>) => unknown)(RMBG_PROCESSOR);
      }
      return { model, processor };
    })();
    pipelines.set(key, p);
    p.catch(() => pipelines.delete(key));
  }
  const { model, processor } = await pipelines.get(key) as { model: Record<string, unknown>; processor: ((img: unknown) => Promise<{ pixel_values: unknown }>) & { size?: unknown; image_processor?: { size?: unknown } } };
  // Matting networks are fully convolutional; a smaller working size trades edge crispness for memory.
  const target = { width: size, height: size };
  if (processor.image_processor) processor.image_processor.size = target; else processor.size = target;
  const { pixel_values } = await processor(image);
  const session = (model.sessions as Record<string, { inputNames: string[]; outputNames: string[] }>)['model'];
  const inputs = session.inputNames.includes('pixel_values') ? { pixel_values } : { [session.inputNames[0]]: pixel_values };
  const out = await (model as unknown as (i: Record<string, unknown>) => Promise<Record<string, unknown>>)(inputs);
  let tensor = out[session.outputNames[0]] as { dims: number[]; data: ArrayLike<number>; min: () => { item: () => number }; max: () => { item: () => number }; sigmoid: () => unknown; mul: (n: number) => { to: (t: string) => unknown }; unsqueeze: (d: number) => unknown; [k: number]: unknown };
  // Batch dimension off: expect [1, H, W] (channel, height, width) for RawImage.fromTensor.
  if (tensor.dims.length === 4) tensor = (tensor as unknown as Record<number, typeof tensor>)[0];
  if (tensor.dims.length === 2) tensor = tensor.unsqueeze(0) as typeof tensor;
  const lo = tensor.min().item(), hi = tensor.max().item();
  if (lo < -1e-3 || hi > 1 + 1e-3) tensor = tensor.sigmoid() as typeof tensor;
  const img = image as { width: number; height: number };
  const matte = await (tf.RawImage.fromTensor(tensor.mul(255).to('uint8') as never) as unknown as { resize: (w: number, h: number) => Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number }> }).resize(img.width, img.height);
  return matte;
}

async function runCutout(id: string, blob: Blob, candidates: CutoutSpec[], size: number, preferCpu: boolean) {
  const tf = await loadLibrary(id);
  const image = await tf.RawImage.fromBlob(blob);
  post({ id, kind: 'progress', progress: 1, status: `Photo decoded (${(image as { width: number }).width} px wide); loading the cutout model…` });
  const devices = deviceOrder(preferCpu);
  let lastError: unknown = null;
  for (const cand of candidates) {
    for (const a of devices) {
      try {
        post({ id, kind: 'progress', progress: 1, status: `Cutout: loading ${cand.label} on ${a.device === 'wasm' ? 'the CPU (slower, steadier on tablets)' : 'the GPU'}…` });
        let width: number, height: number, channels: number, data: Uint8Array | Uint8ClampedArray;
        if (cand.strategy === 'matting-manual') {
          const matte = await runMattingManual(cand.id, image, a.device, a.dtype, id, `Cutout (${cand.label})`, size);
          ({ width, height, channels, data } = matte);
        } else {
          const pipe = await getPipeline('background-removal', cand.id, a.device, a.dtype, id, `Cutout (${cand.label})`) as ((img: unknown) => Promise<{ width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray }>) & { processor?: { image_processor?: { size?: unknown } } };
          if (pipe.processor?.image_processor && size < 1024) pipe.processor.image_processor.size = { width: size, height: size };
          post({ id, kind: 'progress', progress: 99, status: `Cutout: running ${cand.label} on ${a.device}…` });
          ({ width, height, channels, data } = await pipe(image));
        }
        const n = width * height;
        const alpha = new Uint8Array(n);
        if (channels === 4) for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];
        else if (channels === 1) for (let i = 0; i < n; i++) alpha[i] = data[i];
        else if (channels === 3) for (let i = 0; i < n; i++) alpha[i] = data[i * 3];
        else throw new Error(`Unexpected cutout output with ${channels} channels`);
        let on = 0;
        for (const v of alpha) if (v > 127) on++;
        if (on < n * 0.005 || on > n * 0.995) throw new Error(`${cand.label} returned an empty mask`);
        post({ id, kind: 'cutout', width, height, alpha, device: a.device, model: cand.label }, [alpha.buffer]);
        return;
      } catch (err) {
        lastError = err;
        const msg = (err as Error).message ?? String(err);
        post({ id, kind: 'progress', progress: 1, status: `Cutout: ${cand.label} on ${a.device}/${a.dtype} failed (${msg.slice(0, 140)}); trying the next option…` });
        if (isLoadFailure(err)) break; // this model will not load here at all; next candidate
      }
    }
  }
  throw lastError ?? new Error('Background removal failed.');
}

self.onmessage = async (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  post({ id: req.id, kind: 'hello', protocol: PROTOCOL });
  if (req.protocol !== PROTOCOL) return;
  try {
    if (req.kind === 'depth') await runDepth(req.id, req.blob, req.model, req.preferCpu);
    else if (req.kind === 'cutout') await runCutout(req.id, req.blob, req.candidates, req.size, req.preferCpu);
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
