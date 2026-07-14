export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, payload] = dataUrl.split(',');
  const mime = header.match(/data:(.*?);/)?.[1] ?? 'application/octet-stream';
  const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
  return new File([bytes], filename, { type: mime });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
