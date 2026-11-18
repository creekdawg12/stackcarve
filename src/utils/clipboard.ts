/** Clipboard helpers that never throw: each resolves to whether it worked, so callers can say what to do instead. */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the old way */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

/**
 * Put a PNG on the clipboard. The blob is passed as a promise because Safari only allows the
 * write while the tap is still being handled; it waits for the picture on its own.
 */
export async function copyImage(makePng: () => Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': makePng() })]);
    return true;
  } catch { return false; }
}

export type PasteResult = { ok: true; images: Blob[] } | { ok: false; reason: 'unsupported' | 'blocked' };

/** Read pictures off the clipboard from a button press (the browser may ask first). */
export async function readClipboardImages(): Promise<PasteResult> {
  if (!navigator.clipboard?.read) return { ok: false, reason: 'unsupported' };
  try {
    const items = await navigator.clipboard.read();
    const images: Blob[] = [];
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) images.push(await item.getType(type));
    }
    return { ok: true, images };
  } catch { return { ok: false, reason: 'blocked' }; }
}

/** Pictures carried by a paste or drop event. */
export function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter(f => f.type.startsWith('image/'));
  if (files.length) return files;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) out.push(f); }
  }
  return out;
}
