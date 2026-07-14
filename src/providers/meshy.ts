import type { ImageTo3DOptions, ImageTo3DProvider } from './types';
import { fileToDataUrl, sleep } from '../utils/files';

const API = 'https://api.meshy.ai';

function endpoint(url: string, proxyUrl?: string) {
  if (!proxyUrl?.trim()) return url;
  const proxy = proxyUrl.trim().replace(/\/$/, '');
  return `${proxy}?url=${encodeURIComponent(url)}`;
}

async function checkedFetch(url: string, init: RequestInit, proxyUrl?: string) {
  const res = await fetch(endpoint(url, proxyUrl), init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meshy request failed (${res.status}): ${body || res.statusText}`);
  }
  return res;
}

export const MeshyProvider: ImageTo3DProvider = {
  id: 'meshy',
  name: 'Meshy Image to 3D',
  async generate(image: File, options: ImageTo3DOptions) {
    const imageUrl = await fileToDataUrl(image);
    options.onProgress?.(1, 'Submitting image to Meshy…');
    const create = await checkedFetch(`${API}/openapi/v1/image-to-3d`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageUrl,
        model_type: options.modelType,
        ai_model: 'latest',
        should_texture: false,
        should_remesh: options.modelType === 'standard',
        target_polycount: options.targetPolycount,
        target_formats: ['glb']
      }),
      signal: options.signal
    }, options.proxyUrl);
    const { result: id } = await create.json() as { result: string };
    if (!id) throw new Error('Meshy did not return a task id.');

    for (;;) {
      await sleep(2500, options.signal);
      const response = await checkedFetch(`${API}/openapi/v1/image-to-3d/${id}`, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        signal: options.signal
      }, options.proxyUrl);
      const task = await response.json() as {
        status: string;
        progress?: number;
        model_urls?: { glb?: string };
        task_error?: { message?: string };
      };
      options.onProgress?.(Math.max(2, task.progress ?? 0), `Meshy: ${task.status.toLowerCase().replaceAll('_', ' ')}`);
      if (task.status === 'FAILED' || task.status === 'EXPIRED') throw new Error(task.task_error?.message || `Meshy task ${task.status.toLowerCase()}.`);
      if (task.status === 'SUCCEEDED') {
        const glb = task.model_urls?.glb;
        if (!glb) throw new Error('Meshy completed without a GLB output.');
        options.onProgress?.(100, 'Downloading generated GLB…');
        return checkedFetch(glb, { signal: options.signal }, options.proxyUrl).then(r => r.arrayBuffer());
      }
    }
  }
};
