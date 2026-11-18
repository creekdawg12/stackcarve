import type { ReliefBase } from '../types';
import type { Picture } from './types';

/**
 * The tray survives a reload. Handing a prompt to ChatGPT means leaving this page, and a tablet
 * may well drop the tab while it is in the background; coming back to an empty tray would undo
 * the whole exchange. One record in its own IndexedDB database, this browser only.
 */
const DB = 'stackcarve-design', STORE = 'tray', KEY = 'state';

interface StoredPicture extends Omit<Picture, 'depth' | 'state' | 'error'> {
  /** Depth quantised to 8 bits; a quarter of the size and plenty for cutting. */
  depth8: Uint8Array | null;
}

export interface TrayRecord {
  savedAt: number;
  pictures: StoredPicture[];
  activeId: string | null;
  selectedId: string | null;
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
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

export function packPicture(p: Picture): StoredPicture {
  const { depth, state: _state, error: _error, ...rest } = p;
  let depth8: Uint8Array | null = null;
  if (depth) {
    depth8 = new Uint8Array(depth.values.length);
    for (let i = 0; i < depth8.length; i++) depth8[i] = Math.max(0, Math.min(255, Math.round(depth.values[i] * 255)));
  }
  return { ...rest, depth8 };
}

export function unpackPicture(s: StoredPicture): Picture {
  const { depth8, ...rest } = s;
  let depth: ReliefBase | null = null;
  if (depth8 && depth8.length === s.width * s.height) {
    const values = new Float32Array(depth8.length);
    for (let i = 0; i < values.length; i++) values[i] = depth8[i] / 255;
    depth = { source: 'depth', width: s.width, height: s.height, values };
  }
  const mask = s.mask && s.mask.length === s.width * s.height ? s.mask : null;
  return { ...rest, mask, maskFrom: mask ? s.maskFrom : null, depth, state: depth ? 'ready' : 'new' };
}

export async function writeTray(pictures: Picture[], activeId: string | null, selectedId: string | null) {
  const record: TrayRecord = { savedAt: Date.now(), pictures: pictures.map(packPicture), activeId, selectedId };
  try { await tx('readwrite', store => store.put(record, KEY)); } catch { /* best effort */ }
}

export async function readTray(): Promise<{ savedAt: number; pictures: Picture[]; activeId: string | null; selectedId: string | null } | null> {
  try {
    const record = await tx<TrayRecord | undefined>('readonly', store => store.get(KEY));
    if (!record || !Array.isArray(record.pictures)) return null;
    return { savedAt: record.savedAt, pictures: record.pictures.map(unpackPicture), activeId: record.activeId ?? null, selectedId: record.selectedId ?? null };
  } catch { return null; }
}

export async function clearTray() {
  try { await tx('readwrite', store => store.delete(KEY)); } catch { /* best effort */ }
}

/* ---------- Small preferences: the idea being worked on and any edits to the prompt ---------- */

const PREFS_KEY = 'stackcarve.design.v1';

export interface DesignPrefs {
  idea: string;
  takes: 'four' | 'one';
  /** Edited prompts, by kind. Missing means the built-in one. */
  templates: { four?: string; one?: string };
  /** The idea the prompt was last handed over for, so the next step can be "paste". */
  sentFor: string;
  /** When that was, so a picture arriving soon after can be taken for the answer. */
  sentAt: number;
  /** Slab previews: seen from an angle (the default) or dead on. */
  angled: boolean;
}

export const DEFAULT_PREFS: DesignPrefs = { idea: '', takes: 'four', templates: {}, sentFor: '', sentAt: 0, angled: true };

export function readPrefs(): DesignPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return DEFAULT_PREFS;
    const data = JSON.parse(raw) as Partial<DesignPrefs>;
    return {
      idea: typeof data.idea === 'string' ? data.idea : '',
      takes: data.takes === 'one' ? 'one' : 'four',
      templates: { four: typeof data.templates?.four === 'string' ? data.templates.four : undefined, one: typeof data.templates?.one === 'string' ? data.templates.one : undefined },
      sentFor: typeof data.sentFor === 'string' ? data.sentFor : '',
      sentAt: typeof data.sentAt === 'number' && Number.isFinite(data.sentAt) ? data.sentAt : 0,
      angled: data.angled !== false
    };
  } catch { return DEFAULT_PREFS; }
}

export function writePrefs(prefs: DesignPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
}

/* ---------- Where you were: a reload goes back to the Design step only if that is where it left off ---------- */

const PLACE_KEY = 'stackcarve.design.onDesign';

export function rememberOnDesign(onDesign: boolean) {
  try { localStorage.setItem(PLACE_KEY, onDesign ? '1' : '0'); } catch { /* storage full or blocked */ }
}

export function wasOnDesign(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PLACE_KEY) === '1'; } catch { return false; }
}
