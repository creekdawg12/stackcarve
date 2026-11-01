import { AI_MODELS } from '../defaults';

export type CutoutSpec = { id: string; label: string; strategy: 'matting-manual' | 'pipeline'; license: string };

/** Bumped whenever the worker message shapes change; a stale page talking to a new worker is told to reload. */
export const AI_PROTOCOL = 3;

export type AiRequest =
  | { id: string; kind: 'depth'; blob: Blob; model: string; preferCpu: boolean; protocol: number }
  | { id: string; kind: 'cutout'; blob: Blob; candidates: CutoutSpec[]; size: number; preferCpu: boolean; protocol: number };

export type AiResponse =
  | { id: string; kind: 'hello'; protocol: number }
  | { id: string; kind: 'progress'; progress: number; status: string }
  | { id: string; kind: 'depth'; width: number; height: number; values: Float32Array; device: string }
  | { id: string; kind: 'cutout'; width: number; height: number; alpha: Uint8Array; device: string; model: string }
  | { id: string; kind: 'error'; message: string };

export type ProgressFn = (progress: number, status: string) => void;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<string, (err: Error) => void>();

function getWorker() {
  worker ??= new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Drop the worker and its loaded models (frees GPU memory). */
export function resetAi() {
  worker?.terminate();
  worker = null;
}

/** Stop whatever the worker is doing; the waiting caller gets a "Cancelled" error. */
export function cancelAi() {
  for (const reject of pending.values()) reject(new Error('Cancelled'));
  pending.clear();
  resetAi();
}

type RequestBody = AiRequest extends infer R ? (R extends { id: string } ? Omit<R, 'id' | 'protocol'> : never) : never;

const SLOW_AFTER_MS = 15000;
const GIVE_UP_AFTER_MS = 90000;

function request<T extends AiResponse['kind']>(req: RequestBody, want: T, onProgress?: ProgressFn): Promise<Extract<AiResponse, { kind: T }>> {
  const id = `ai-${++seq}`;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    let lastWord = Date.now();
    let heard = false;
    let settled = false;
    // Models stay resident in GPU and wasm memory while the worker lives. Tablets run out of
    // memory with two of them loaded, so the worker is dropped after every job; the browser's
    // cache keeps the downloaded files, so the next run only pays a few seconds of setup.
    const finish = () => {
      settled = true;
      clearInterval(watchdog);
      pending.delete(id);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onError as EventListener);
      resetAi();
    };
    const fail = (err: Error) => { if (settled) return; finish(); reject(err); };
    pending.set(id, fail);
    const onMessage = (e: MessageEvent<AiResponse>) => {
      const msg = e.data;
      if (msg.id !== id && msg.id !== '*') return;
      lastWord = Date.now();
      heard = true;
      if (msg.kind === 'hello') {
        if (msg.protocol !== AI_PROTOCOL) fail(new Error('This page is out of date with its AI worker. Reload the page (hold the reload button on iPad) and try again.'));
        return;
      }
      if (msg.kind === 'progress') { onProgress?.(msg.progress, msg.status); return; }
      finish();
      if (msg.kind === 'error') reject(new Error(msg.message));
      else if (msg.kind === want) resolve(msg as Extract<AiResponse, { kind: T }>);
      else reject(new Error(`Unexpected worker reply ${msg.kind}`));
    };
    const onError = (e: ErrorEvent) => fail(new Error(e.message || 'The AI worker failed to start. Reload the page and try again.'));
    const watchdog = setInterval(() => {
      const idle = Date.now() - lastWord;
      if (idle > GIVE_UP_AFTER_MS) {
        fail(new Error(heard
          ? `The AI worker went quiet for ${Math.round(idle / 1000)} s. Reload the page and try again; if it keeps happening on this device, run this step on the shop PC.`
          : 'The AI worker never started (90 s). Reload the page, and if it keeps happening on this device, run this step on the shop PC.'));
      } else if (idle > SLOW_AFTER_MS) {
        onProgress?.(1, heard
          ? `Still working, ${Math.round(idle / 1000)} s without an update. Large downloads can pause; Cancel is available.`
          : `Waiting for the AI worker to start (${Math.round(idle / 1000)} s). If this does not move, reload the page.`);
      }
    }, 2500);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onError as EventListener);
    w.postMessage({ ...req, id, protocol: AI_PROTOCOL } as AiRequest);
  });
}

/** Relative depth of a photo at the model's working resolution; larger = closer. Not yet normalised. */
export function estimateDepth(blob: Blob, onProgress?: ProgressFn) {
  return request({ kind: 'depth', blob, model: AI_MODELS.depth, preferCpu: false }, 'depth', onProgress);
}

/** Alpha matte of the photo's subject (0 = background) at the photo's native size. */
/** Tablets and phones get a smaller matte: a quarter of the memory of the full 1024 px pass. */
export function isLowMemoryDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === 'number') return nav.deviceMemory <= 4;
  return (nav.maxTouchPoints ?? 0) > 1;
}

export function removeBackground(blob: Blob, onProgress?: ProgressFn) {
  const low = isLowMemoryDevice();
  // Tablets: the CPU path is slower but has not crashed; the GPU path stays as the fallback.
  return request({ kind: 'cutout', blob, candidates: AI_MODELS.cutout.map(c => ({ ...c })), size: low ? 768 : 1024, preferCpu: low }, 'cutout', onProgress);
}

export function aiSupported() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export function webGpuAvailable() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
