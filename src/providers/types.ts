export interface ImageTo3DOptions {
  apiKey: string;
  proxyUrl?: string;
  modelType: 'standard' | 'lowpoly';
  targetPolycount: number;
  onProgress?: (progress: number, status: string) => void;
  signal?: AbortSignal;
}

export interface ImageTo3DProvider {
  id: string;
  name: string;
  generate(image: File, options: ImageTo3DOptions): Promise<ArrayBuffer>;
}
