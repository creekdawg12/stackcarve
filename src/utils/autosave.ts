import type { ProjectSettings, ReliefBase, SourceAsset, StoredRelief } from '../types';
import { decodeRelief, encodeRelief } from '../export/project';

/**
 * Crash insurance. The photo, its depth and mask and the settings are written to IndexedDB a
 * moment after they change, so a tab that Safari reloads for memory can offer them back.
 * One slot, this browser only; the project file remains the real save.
 */
const DB = 'stackcarve', STORE = 'session', KEY = 'last';

export interface AutosaveRecord {
  savedAt: string;
  projectName: string;
  settings: ProjectSettings;
  sourceAsset: SourceAsset | null;
  relief?: StoredRelief;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export async function writeAutosave(input: { projectName: string; settings: ProjectSettings; sourceAsset: SourceAsset | null; base: ReliefBase | null; mask: Uint8Array | null }) {
  const record: AutosaveRecord = {
    savedAt: new Date().toISOString(),
    projectName: input.projectName,
    settings: input.settings,
    sourceAsset: input.sourceAsset,
    relief: encodeRelief(input.base, input.mask)
  };
  try { await tx('readwrite', store => store.put(record, KEY)); } catch { /* best effort */ }
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  try { return (await tx<AutosaveRecord | undefined>('readonly', store => store.get(KEY))) ?? null; } catch { return null; }
}

export async function clearAutosave() {
  try { await tx('readwrite', store => store.delete(KEY)); } catch { /* best effort */ }
}

export function decodeAutosaveRelief(record: AutosaveRecord) {
  return decodeRelief(record.relief);
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce rapid changes (brush strokes, slider drags) into one write. */
export function scheduleAutosave(input: Parameters<typeof writeAutosave>[0], delayMs = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void writeAutosave(input); }, delayMs);
}
