import { AI_MODELS } from '../defaults';

export type CutoutSpec = { id: string; label: string; strategy: 'matting-manual' | 'pipeline'; license: string };

export type AiRequest =
  | { id: string; kind: 'depth'; blob: Blob; model: string }
  | { id: string; kind: 'cutout'; blob: Blob; candidates: CutoutSpec[]; size: number };

export type AiResponse =
  | { id: string; kind: 'progress'; progress: number; status: string }
  | { id: string; kind: 'depth'; width: number; height: number; values: Float32Array; device: string }
  | { id: string; kind: 'cutout'; width: number; height: number; alpha: Uint8Array; device: string; model: string }
  | { id: string; kind: 'error'; message: string };

export type ProgressFn = (progress: number, status: string) => void;

let worker: Worker | null = null;
let seq = 0;

function getWorker() {
  worker ??= new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Drop the worker and its loaded models (frees GPU memory). */
export function resetAi() {
  worker?.terminate();
  worker = null;
}

type RequestBody = AiRequest extends infer R ? (R extends { id: string } ? Omit<R, 'id'> : never) : never;

function request<T extends AiResponse['kind']>(req: RequestBody, want: T, onProgress?: ProgressFn): Promise<Extract<AiResponse, { kind: T }>> {
  const id = `ai-${++seq}`;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    // Models stay resident in GPU and wasm memory while the worker lives. Tablets run out of
    // memory with two of them loaded, so the worker is dropped after every job; the browser's
    // cache keeps the downloaded files, so the next run only pays a few seconds of setup.
    const finish = () => { w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); resetAi(); };
    const onMessage = (e: MessageEvent<AiResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.kind === 'progress') { onProgress?.(msg.progress, msg.status); return; }
      finish();
      if (msg.kind === 'error') reject(new Error(msg.message));
      else if (msg.kind === want) resolve(msg as Extract<AiResponse, { kind: T }>);
      else reject(new Error(`Unexpected worker reply ${msg.kind}`));
    };
    const onError = (e: ErrorEvent) => {
      finish();
      reject(new Error(e.message || 'The AI worker crashed. Reload the page and try again.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ ...req, id } as AiRequest);
  });
}

/** Relative depth of a photo at the model's working resolution; larger = closer. Not yet normalised. */
export function estimateDepth(blob: Blob, onProgress?: ProgressFn) {
  return request({ kind: 'depth', blob, model: AI_MODELS.depth }, 'depth', onProgress);
}

/** Alpha matte of the photo's subject (0 = background) at the photo's native size. */
/** Tablets and phones get a smaller matte: a quarter of the memory of the full 1024 px pass. */
export function isLowMemoryDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === 'number') return nav.deviceMemory <= 4;
  return (nav.maxTouchPoints ?? 0) > 1;
}

export function removeBackground(blob: Blob, onProgress?: ProgressFn) {
  const size = isLowMemoryDevice() ? 768 : 1024;
  return request({ kind: 'cutout', blob, candidates: AI_MODELS.cutout.map(c => ({ ...c })), size }, 'cutout', onProgress);
}

export function aiSupported() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export function webGpuAvailable() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
