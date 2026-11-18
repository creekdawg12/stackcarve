import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { aiFailure, aiSupported, estimateDepth, resetAi, webGpuAvailable } from '../relief/ai';
import { buildLuminanceBase, normalizeDepth, resampleGrid, suggestFloor } from '../relief/heightmap';
import { dataUrlToFile } from '../utils/files';
import { copyText, imagesFrom, readClipboardImages } from '../utils/clipboard';
import type { ReliefBase } from '../types';
import { buildPrompt, chatGptLink, cleanIdea, DEFAULT_TEMPLATES, type Takes } from './prompt';
import { intake, newId, quarter as cutQuarters } from './intake';
import { topPick } from './judge';
import { clearTray, readPrefs, readTray, rememberOnDesign, wasOnDesign, writePrefs, writeTray, type DesignPrefs } from './storage';
import { TRAY_LIMIT, type Picture } from './types';

/** What the stage shows in the Design step: the pictures side by side, or the bench for the one in use. */
export type DesignView = 'pictures' | 'tune';

interface DesignValue {
  idea: string;
  setIdea: (idea: string) => void;
  takes: Takes;
  setTakes: (takes: Takes) => void;
  /** The prompt text being used for this kind, edited or built in, with its {idea} placeholder. */
  template: string;
  /** True when the prompt has been edited away from the built-in one. */
  templateEdited: boolean;
  setTemplate: (text: string | null) => void;
  /** The finished prompt, idea filled in. */
  prompt: string;
  /** A ChatGPT address that opens with the prompt in the box. */
  link: string;
  /** True once the prompt for the idea as it stands has been handed over. */
  sent: boolean;
  /** Copy the prompt and note that it went out. The caller opens the link. */
  handOff: () => void;
  /** Copy the prompt and open ChatGPT in a new tab. */
  openChatGpt: () => void;
  copyPrompt: () => void;
  angled: boolean;
  setAngled: (angled: boolean) => void;

  pictures: Picture[];
  /** The picture the slicer is working from, if it is one of the tray's. */
  activeId: string | null;
  selectedId: string | null;
  select: (id: string | null) => void;
  view: DesignView;
  setView: (view: DesignView) => void;
  /** Pictures waiting for depth. */
  waiting: Picture[];
  addImages: (files: Blob[]) => Promise<void>;
  /** Read the clipboard from a button press. */
  paste: () => Promise<void>;
  judge: () => Promise<void>;
  use: (id: string) => Promise<void>;
  useTopPick: () => Promise<void>;
  remove: (id: string) => void;
  /** Empty the tray of everything except the picture in use. */
  removeOthers: () => void;
  /** Drop a picture by its image, when the saved session it belonged to is discarded. */
  forget: (dataUrl: string) => void;
  /** Cut one picture that is really a sheet of four into its quarters. */
  quarter: (id: string) => Promise<void>;
  /** The last sheet that was split, when it came apart into something other than four. */
  oddSplit: { count: number } | null;
  /** Throw away how that sheet was split and cut it into four equal quarters instead. */
  quarterLastSheet: () => Promise<void>;
  /** Empty the tray. With everything set, the idea goes too, for a fresh project. */
  clear: (everything?: boolean) => void;
  say: (status: string) => void;
}

const Ctx = createContext<DesignValue | null>(null);

const fileName = (p: Picture) => `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'picture'}.jpg`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** How long after the last change a reload still drops you back among the pictures. */
const RESUME_WINDOW_MS = 60 * 60 * 1000;
/** How long after a hand-off a lone picture is still taken for the sheet that was asked for. */
const ANSWER_WINDOW_MS = 3 * 60 * 60 * 1000;

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const { settings, sourceAsset, reliefBase, mask, step, dispatch } = useStore();
  const [prefs, setPrefs] = useState<DesignPrefs>(readPrefs);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<DesignView>('pictures');
  const [loaded, setLoaded] = useState(false);
  // The last pasted sheet, kept so a split that came out wrong can be redone as plain quarters.
  const [lastSheet, setLastSheet] = useState<{ blob: Blob; ids: string[] } | null>(null);

  // Async work reads the latest state through refs; closures would hold the state from when it started.
  const picturesRef = useRef(pictures); picturesRef.current = pictures;
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const stepRef = useRef(step); stepRef.current = step;
  const hasPhotoRef = useRef(false); hasPhotoRef.current = !!reliefBase && sourceAsset?.kind === 'image';
  const judging = useRef(false);

  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;

  const say = useCallback((status: string) => dispatch({ type: 'busy', label: null, status }), [dispatch]);
  const patchPrefs = useCallback((patch: Partial<DesignPrefs>) => setPrefs(p => ({ ...p, ...patch })), []);
  useEffect(() => { const id = setTimeout(() => writePrefs(prefs), 300); return () => clearTimeout(id); }, [prefs]);

  const template = prefs.templates[prefs.takes] ?? DEFAULT_TEMPLATES[prefs.takes];
  const prompt = useMemo(() => buildPrompt(prefs.idea, prefs.takes, prefs.templates[prefs.takes]), [prefs.idea, prefs.takes, prefs.templates]);
  const link = useMemo(() => chatGptLink(prompt), [prompt]);
  const idea = cleanIdea(prefs.idea);
  const sent = !!idea && prefs.sentFor === idea;

  const handOff = useCallback(() => {
    void copyText(prompt);
    patchPrefs({ sentFor: idea, sentAt: Date.now() });
    say('Prompt copied. In ChatGPT, send it (paste it if the box is empty), copy the picture it makes, then come back and paste it here.');
  }, [idea, patchPrefs, prompt, say]);

  const openChatGpt = useCallback(() => {
    if (!idea) return say('Describe what to make first, then the prompt can be written.');
    // Both in the same tap: the copy first, while this page still has the focus a browser asks for,
    // then the new tab, opened straight from the tap so it is not treated as a pop-up.
    handOff();
    window.open(link, '_blank', 'noopener');
  }, [handOff, idea, link, say]);

  const copyPrompt = useCallback(() => {
    void copyText(prompt).then(ok => say(ok ? 'Prompt copied.' : 'Could not copy. Select the prompt text and copy it by hand.'));
  }, [prompt, say]);

  /** Make a tray picture the photo the slicer works from, carrying its depth and cutout across. */
  const activate = useCallback(async (p: Picture, nextView?: DesignView) => {
    let base: ReliefBase;
    try { base = p.depth ?? await buildLuminanceBase(dataUrlToFile(p.dataUrl, fileName(p))); }
    catch (e) { return say(`Could not open that picture (${e instanceof Error ? e.message : String(e)}).`); }
    const cutout = p.mask && p.mask.length === base.width * base.height ? p.mask : null;
    setActiveId(p.id);
    dispatch({ type: 'source', asset: { kind: 'image', name: fileName(p), mimeType: p.mimeType, dataUrl: p.dataUrl, sizeBytes: Math.round(p.dataUrl.length * 0.75) } });
    dispatch({ type: 'reliefBase', base, mask: cutout });
    const relief = { ...settingsRef.current.relief, source: p.depth ? 'depth' as const : 'luminance' as const, depthFloor: 0 };
    // The wall plane fitted to the last picture would slice into this one; fit it to this subject.
    dispatch({ type: 'relief', value: { source: relief.source, depthFloor: p.depth && cutout ? suggestFloor(base, cutout, relief) : 0 } });
    if (nextView) setView(nextView);
  }, [dispatch, say]);

  const addImages = useCallback(async (files: Blob[]) => {
    const images = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test((f as File).name ?? ''));
    if (!images.length) return;
    const room = TRAY_LIMIT - picturesRef.current.length;
    if (room <= 0) return say(`The tray holds ${TRAY_LIMIT} pictures. Remove some before adding more.`);
    dispatch({ type: 'busy', label: 'Reading pictures', progress: 30, status: 'Looking for the subject in each picture…' });
    try {
      const added: Picture[] = [];
      let sheets = 0;
      // A four-take prompt went out a short while ago and the tray is empty, so one picture coming
      // back whole is probably the sheet, drawn in a way that would not come apart on its own.
      const asked = prefsRef.current;
      const awaitingSheet = asked.takes === 'four' && !!asked.sentFor && Date.now() - asked.sentAt < ANSWER_WINDOW_MS && images.length === 1 && picturesRef.current.length === 0;
      for (const [i, file] of images.entries()) {
        const result = await intake(file, (file as File).name || `pasted-${i + 1}.png`);
        if (result.split) sheets++;
        if (result.split || awaitingSheet) setLastSheet({ blob: file, ids: result.pictures.map(p => p.id) });
        added.push(...result.pictures);
      }
      const fit = added.slice(0, room);
      const before = picturesRef.current;
      setPictures([...before, ...fit]);
      if (stepRef.current !== 'source') dispatch({ type: 'step', value: 'source' });
      const full = added.length > fit.length ? ` The tray is full, so ${plural(added.length - fit.length, 'picture')} did not fit.` : '';
      const maybeSheet = awaitingSheet && !sheets && fit.length === 1;
      // One picture onto an empty bench is simply the photo to work on, as it always was.
      if (fit.length === 1 && before.length === 0 && !hasPhotoRef.current && !maybeSheet) {
        await activate(fit[0], 'tune');
        setSelectedId(fit[0].id);
        dispatch({ type: 'busy', label: null, progress: 100, status: fit[0].mask ? 'Picture added and its plain background cut away. Next: estimate depth.' : 'Picture added. Next: estimate depth, then cut out the subject.' });
        return;
      }
      setSelectedId(fit[0].id);
      setView('pictures');
      dispatch({
        type: 'busy', label: null, progress: 100,
        status: maybeSheet
          ? 'Picture added in one piece. If it holds four designs, cut it into quarters. If not, judge it to see how it will carve.'
          : `${sheets ? `Split the sheet into ${plural(fit.length, 'picture')}` : `${plural(fit.length, 'picture')} added`}. Judge them to see how each will carve.${full}`
      });
    } catch (e) {
      say(`Could not read that picture (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, [activate, dispatch, say]);

  const paste = useCallback(async () => {
    const result = await readClipboardImages();
    if (!result.ok) return say(result.reason === 'unsupported'
      ? 'This browser cannot paste from a button. Press Ctrl+V, or drop the picture onto the page.'
      : 'The browser did not allow the paste. Press Ctrl+V with this page in front, or drop the picture here.');
    if (!result.images.length) return say('No picture on the clipboard. In ChatGPT, copy the image itself, then paste again.');
    await addImages(result.images.map((b, i) => new File([b], `pasted-${i + 1}.png`, { type: b.type })));
  }, [addImages, say]);

  const judge = useCallback(async () => {
    if (judging.current) return;
    const todo = picturesRef.current.filter(p => !p.depth);
    if (!todo.length) return;
    if (!aiSupported()) return say('This browser cannot run the depth model (it needs Web Workers and OffscreenCanvas).');
    judging.current = true;
    const label = 'Judging pictures';
    dispatch({ type: 'busy', label, progress: 1, status: `Starting the depth model on ${webGpuAvailable() ? 'the GPU' : 'the CPU (slower)'}…` });
    let current: Picture | null = null;
    let done = 0;
    try {
      for (const [i, p] of todo.entries()) {
        current = p;
        setPictures(ps => ps.map(x => x.id === p.id ? { ...x, state: 'judging', error: undefined } : x));
        const of = todo.length > 1 ? `Picture ${i + 1} of ${todo.length}. ` : '';
        const out = await estimateDepth(dataUrlToFile(p.dataUrl, fileName(p)), (progress, status) => dispatch({ type: 'busy', label, progress: Math.round((i + progress / 100) / todo.length * 100), status: of + status }), { keepWorker: i < todo.length - 1 });
        const values = resampleGrid(normalizeDepth(out.values), out.width, out.height, p.width, p.height);
        const depth: ReliefBase = { source: 'depth', width: p.width, height: p.height, values };
        setPictures(ps => ps.map(x => x.id === p.id ? { ...x, depth, state: 'ready', error: undefined } : x));
        done++;
        // The picture in use gets its depth on the bench too, with the wall plane fitted to it.
        if (activeRef.current === p.id) {
          const cutout = picturesRef.current.find(x => x.id === p.id)?.mask ?? null;
          dispatch({ type: 'reliefBase', base: depth });
          const relief = { ...settingsRef.current.relief, source: 'depth' as const, depthFloor: 0 };
          dispatch({ type: 'relief', value: { source: 'depth', depthFloor: cutout ? suggestFloor(depth, cutout, relief) : 0 } });
        }
      }
      dispatch({ type: 'busy', label: null, progress: 100, status: `Judged ${plural(done, 'picture')}. Tap one to see how it carves.` });
    } catch (e) {
      const cancelled = e instanceof Error && e.message === 'Cancelled';
      const failed = current;
      if (failed) setPictures(ps => ps.map(x => x.id === failed.id ? { ...x, state: cancelled ? 'new' : 'failed', error: cancelled ? undefined : (e instanceof Error ? e.message : String(e)) } : x));
      say(aiFailure('Judging', e));
    } finally {
      resetAi();
      judging.current = false;
    }
  }, [dispatch, say]);

  const use = useCallback(async (id: string) => {
    const p = picturesRef.current.find(x => x.id === id);
    if (!p) return;
    // With depth and a cutout it is ready to slice; without, the bench is where those get made.
    const ready = !!p.depth && !!p.mask;
    await activate(p, ready ? undefined : 'tune');
    setSelectedId(id);
    say(ready ? `Using ${p.name}. Generate slices when you are ready.` : p.depth ? `Using ${p.name}. Next: cut out the subject.` : `Using ${p.name}. Next: estimate depth.`);
  }, [activate, say]);

  const useTopPick = useCallback(async () => {
    const best = topPick(picturesRef.current, settingsRef.current);
    if (best) await use(best.id);
  }, [use]);

  const remove = useCallback((id: string) => {
    if (activeRef.current === id) return say('That picture is the one in use. Use another one first, then remove it.');
    setPictures(ps => ps.filter(p => p.id !== id));
    setSelectedId(s => s === id ? null : s);
  }, [say]);

  const removeOthers = useCallback(() => {
    const going = picturesRef.current.filter(p => p.id !== activeRef.current);
    if (!going.length) return;
    // Judged pictures took a while to make; ask before throwing that away.
    if (going.some(p => p.depth) && !window.confirm(`Remove ${plural(going.length, 'picture')} from the tray?`)) return;
    setPictures(ps => ps.filter(p => p.id === activeRef.current));
    setSelectedId(activeRef.current);
    setLastSheet(null);
    say(`Removed ${plural(going.length, 'picture')}.`);
  }, [say]);

  const forget = useCallback((dataUrl: string) => {
    setPictures(ps => ps.filter(p => p.dataUrl !== dataUrl || p.id === activeRef.current));
  }, []);

  /** Take pictures off the bench before they leave the tray, so the slicer is not left holding a photo that is gone. */
  const release = useCallback((ids: string[]) => {
    if (!activeRef.current || !ids.includes(activeRef.current)) return;
    setActiveId(null);
    dispatch({ type: 'source', asset: null });
    dispatch({ type: 'reliefBase', base: null, mask: null });
  }, [dispatch]);

  const quarter = useCallback(async (id: string) => {
    const p = picturesRef.current.find(x => x.id === id);
    if (!p) return;
    if (picturesRef.current.length + 3 > TRAY_LIMIT) return say(`The tray holds ${TRAY_LIMIT} pictures. Remove some before cutting this one up.`);
    try {
      const parts = await cutQuarters(dataUrlToFile(p.dataUrl, fileName(p)));
      release([id]);
      setPictures(ps => ps.flatMap(x => x.id === id ? parts : [x]));
      setSelectedId(parts[0].id);
      setView('pictures');
      say('Cut into four pictures. Judge them to see how each will carve.');
    } catch (e) {
      say(`Could not cut that picture up (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, [release, say]);

  const quarterLastSheet = useCallback(async () => {
    if (!lastSheet) return;
    try {
      const parts = await cutQuarters(lastSheet.blob);
      const gone = new Set(lastSheet.ids);
      release(lastSheet.ids);
      setPictures(ps => [...ps.filter(x => !gone.has(x.id)), ...parts]);
      setLastSheet({ blob: lastSheet.blob, ids: parts.map(p => p.id) });
      setSelectedId(parts[0].id);
      setView('pictures');
      say('Cut the sheet into four quarters. Judge them to see how each will carve.');
    } catch (e) {
      say(`Could not cut that sheet up (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, [lastSheet, release, say]);

  const clear = useCallback((everything = false) => {
    setPictures([]); setActiveId(null); setSelectedId(null); setView('pictures'); setLastSheet(null);
    if (everything) setPrefs(p => ({ ...p, idea: '', sentFor: '', sentAt: 0 }));
    void clearTray();
  }, []);

  // Bring the tray back after a reload, and if the Design step was where things stood moments ago, go straight back to it.
  useEffect(() => {
    let cancelled = false;
    const resume = wasOnDesign();
    void readTray().then(saved => {
      if (cancelled) return;
      setLoaded(true);
      if (!saved?.pictures.length) return;
      setPictures(now => {
        const have = new Set(now.map(p => p.dataUrl));
        return [...saved.pictures.filter(p => !have.has(p.dataUrl)), ...now];
      });
      setSelectedId(s => s ?? saved.selectedId ?? saved.pictures[0].id);
      if (resume && Date.now() - saved.savedAt < RESUME_WINDOW_MS && stepRef.current === 'plan' && !hasPhotoRef.current) {
        dispatch({ type: 'step', value: 'source' });
        dispatch({ type: 'busy', label: null, status: `Your ${plural(saved.pictures.length, 'picture')} from earlier ${saved.pictures.length === 1 ? 'is' : 'are'} still here.` });
      }
    });
    return () => { cancelled = true; };
  }, [dispatch]);

  // Save shortly after each change, and at once when the page is hidden: opening ChatGPT hides this
  // tab, and a tablet may drop a hidden tab without running another timer.
  const unsaved = useRef(false);
  const saveNow = useCallback(() => {
    writePrefs(prefsRef.current);
    if (!unsaved.current) return;
    unsaved.current = false;
    const tray = picturesRef.current;
    void (tray.length ? writeTray(tray, activeRef.current, selectedRef.current) : clearTray());
  }, []);
  useEffect(() => { if (loaded) rememberOnDesign(step === 'source'); }, [loaded, step]);
  useEffect(() => {
    if (!loaded) return;
    unsaved.current = true;
    const id = setTimeout(saveNow, 400);
    return () => clearTimeout(id);
  }, [loaded, pictures, activeId, selectedId, saveNow]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saveNow(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveNow);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', saveNow); };
  }, [saveNow]);

  // Keep the tray and the bench telling the same story, whichever one changed.
  useEffect(() => {
    if (!sourceAsset || sourceAsset.kind !== 'image' || !sourceAsset.dataUrl) { if (activeId) setActiveId(null); return; }
    const current = pictures.find(p => p.id === activeId);
    if (!current || current.dataUrl !== sourceAsset.dataUrl) {
      // With nothing else in the tray there is nothing to choose between: go straight to the bench.
      if (pictures.length <= 1) setView('tune');
      const match = pictures.find(p => p.dataUrl === sourceAsset.dataUrl);
      if (match) { setActiveId(match.id); return; }
      // A photo that came in another way (an opened project, a restored session) takes a place in the tray.
      const sized = reliefBase ? { width: reliefBase.width, height: reliefBase.height } : { width: 0, height: 0 };
      const depth = reliefBase?.source === 'depth' ? reliefBase : null;
      const cutout = reliefBase && mask && mask.length === reliefBase.width * reliefBase.height ? mask : null;
      const adopted: Picture = {
        id: newId(), name: sourceAsset.name.replace(/\.[a-z0-9]+$/i, '') || 'photo', position: null,
        dataUrl: sourceAsset.dataUrl, mimeType: sourceAsset.mimeType || 'image/jpeg', ...sized,
        depth, mask: cutout, maskFrom: cutout ? 'tool' : null, state: depth ? 'ready' : 'new', addedAt: Date.now()
      };
      setPictures(ps => [...ps, adopted]);
      setActiveId(adopted.id);
      setSelectedId(s => s ?? adopted.id);
      return;
    }
    if (!reliefBase) return;
    // What the bench did to the picture in use (new depth, a repainted cutout) goes back into the tray.
    const depthChanged = reliefBase.source === 'depth' && current.depth !== reliefBase;
    const maskChanged = current.mask !== mask;
    const sizeChanged = current.width !== reliefBase.width || current.height !== reliefBase.height;
    if (!depthChanged && !maskChanged && !sizeChanged) return;
    setPictures(ps => ps.map(p => p.id !== current.id ? p : {
      ...p,
      width: reliefBase.width, height: reliefBase.height,
      depth: reliefBase.source === 'depth' ? reliefBase : sizeChanged ? null : p.depth,
      mask, maskFrom: mask ? (maskChanged ? 'tool' : p.maskFrom) : null,
      state: reliefBase.source === 'depth' ? 'ready' : p.state
    }));
  }, [sourceAsset, reliefBase, mask, activeId, pictures]);

  // Ctrl+V anywhere in the Design step drops the copied picture into the tray.
  const photoStep = step === 'source' && settings.inputMode === 'relief';
  useEffect(() => {
    if (!photoStep) return;
    const onPaste = (e: ClipboardEvent) => {
      const images = imagesFrom(e.clipboardData);
      if (!images.length) return;
      e.preventDefault();
      void addImages(images);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addImages, photoStep]);

  const waiting = useMemo(() => pictures.filter(p => !p.depth), [pictures]);
  // Only while every picture from that sheet is still in the tray, and it did not come out as four.
  const oddSplit = useMemo(() => {
    if (!lastSheet) return null;
    const still = lastSheet.ids.filter(id => pictures.some(p => p.id === id)).length;
    return still === lastSheet.ids.length && still !== 4 ? { count: still } : null;
  }, [lastSheet, pictures]);

  const value = useMemo<DesignValue>(() => ({
    idea: prefs.idea, setIdea: v => patchPrefs({ idea: v }),
    takes: prefs.takes, setTakes: v => patchPrefs({ takes: v }),
    template, templateEdited: prefs.templates[prefs.takes] != null,
    setTemplate: text => setPrefs(p => ({ ...p, templates: { ...p.templates, [p.takes]: text == null || text === DEFAULT_TEMPLATES[p.takes] ? undefined : text } })),
    prompt, link, sent, handOff, openChatGpt, copyPrompt,
    angled: prefs.angled, setAngled: v => patchPrefs({ angled: v }),
    pictures, activeId, selectedId, select: setSelectedId, view, setView, waiting,
    addImages, paste, judge, use, useTopPick, remove, removeOthers, forget, quarter, oddSplit, quarterLastSheet, clear, say
  }), [prefs, patchPrefs, template, prompt, link, sent, handOff, openChatGpt, copyPrompt, pictures, activeId, selectedId, view, waiting, addImages, paste, judge, use, useTopPick, remove, removeOthers, forget, quarter, oddSplit, quarterLastSheet, clear, say]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDesign() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useDesign must be inside DesignProvider');
  return value;
}
