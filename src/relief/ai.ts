import { AI_MODELS } from '../defaults';

export type CutoutSpec = { id: string; label: string; strategy: 'matting-manual' | 'pipeline'; license: string };

export type AiRequest =
  | { id: string; kind: 'depth'; blob: Blob; model: string }
  | { id: string; kind: 'cutout'; blob: Blob; candidates: CutoutSpec[] };

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
    const onMessage = (e: MessageEvent<AiResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.kind === 'progress') { onProgress?.(msg.progress, msg.status); return; }
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (msg.kind === 'error') reject(new Error(msg.message));
      else if (msg.kind === want) resolve(msg as Extract<AiResponse, { kind: T }>);
      else reject(new Error(`Unexpected worker reply ${msg.kind}`));
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
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
export function removeBackground(blob: Blob, onProgress?: ProgressFn) {
  return request({ kind: 'cutout', blob, candidates: AI_MODELS.cutout.map(c => ({ ...c })) }, 'cutout', onProgress);
}

export function aiSupported() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export function webGpuAvailable() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
