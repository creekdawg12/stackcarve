import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import { useDesign } from './design/DesignContext';
import { loadMeshFile, loadMeshFromArrayBuffer } from './mesh/loadMesh';
import { buildLuminanceBase, maskFromAlpha, maskFromThreshold, normalizeDepth, resampleGrid, suggestFloor } from './relief/heightmap';
import { aiFailure as failure, aiSupported, estimateDepth, removeBackground, webGpuAvailable } from './relief/ai';
import { dataUrlToFile, downloadBlob, fileToDataUrl } from './utils/files';
import { buildResult, nominalCount, sourceReady } from './engine/generate';
import { MeshyProvider } from './providers/meshy';
import { decodeRelief, makeProject, mergeSettings, parseProject } from './export/project';
import { exportAll } from './export/bundle';
import { LAYER_SOFT_LIMIT } from './defaults';
import { STYLES, type StyleId } from './presets';
import { clearAutosave, decodeAutosaveRelief, readAutosave, flushAutosave, scheduleAutosave, type AutosaveRecord } from './utils/autosave';
import type { ReliefBase } from './types';

export type GenerateOutcome = 'done' | 'needs-input' | 'cancelled' | 'failed';

/** Counts the pieces a result holds, leaving the backer plate out. */
export function pieceCount(result: { layers: { parts: { role?: string }[] }[] }) {
  return result.layers.filter(l => l.parts.some(p => p.role !== 'backer')).length;
}

export interface Actions {
  pickPhoto: () => void;
  pickMesh: () => void;
  pickProject: () => void;
  /** keepRelief: depth is about to be supplied from a saved project. keepTuning: the wall plane belongs to this photo already. */
  loadPhoto: (file: File, options?: { keepRelief?: boolean; keepTuning?: boolean }) => Promise<void>;
  loadMesh: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  /** Route a dropped file to the right loader by its type. */
  loadAny: (file: File) => Promise<void>;
  /** Everything a drop carried: pictures go to the tray together, a model or project file is opened. */
  loadDropped: (data: DataTransfer | null) => void;
  runDepth: () => Promise<void>;
  runCutout: () => Promise<void>;
  thresholdMask: () => void;
  clearMask: () => void;
  generate: () => Promise<GenerateOutcome>;
  saveProject: () => void;
  newProject: () => void;
  exportZip: () => void;
  setStyle: (id: StyleId) => void;
  setSource: (kind: 'photo' | 'model') => void;
  generateWithMeshy: (image: File | null, apiKey: string) => Promise<void>;
  /** A photo session found in this browser from before a reload, if any. */
  restorable: AutosaveRecord | null;
  restoreSession: () => Promise<void>;
  discardSession: () => void;
}

const Ctx = createContext<Actions | null>(null);


export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const { settings, patchSettings, sourceAsset, mesh, reliefBase, mask, result, projectName, unsavedAi, dispatch } = useStore();
  const { addImages, clear: clearTray, forget: forgetPicture } = useDesign();
  const [restorable, setRestorable] = useState<AutosaveRecord | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const meshInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const say = useCallback((status: string) => dispatch({ type: 'busy', label: null, status }), [dispatch]);
  // Goes through the reducer so it merges with the settings as they are when it lands, not as they were when a model run started.
  const setRelief = useCallback((value: Partial<typeof settings.relief>) => dispatch({ type: 'relief', value }), [dispatch]);

  const loadMesh = useCallback(async (file: File) => {
    dispatch({ type: 'busy', label: 'Loading model', progress: 15, status: 'Welding vertices and checking the surface…' });
    try {
      const loaded = await loadMeshFile(file);
      dispatch({ type: 'source', asset: { kind: 'mesh', name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: await fileToDataUrl(file), sizeBytes: file.size }, mesh: loaded });
      dispatch({ type: 'step', value: 'source' });
      dispatch({ type: 'busy', label: null, progress: 100, status: `Loaded ${file.name}. Turn it to face you, then generate.` });
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, [dispatch, say]);

  const loadPhoto = useCallback(async (file: File, options: { keepRelief?: boolean; keepTuning?: boolean } = {}) => {
    dispatch({ type: 'busy', label: 'Reading photo', progress: 20, status: 'Reading photo…' });
    try {
      const base = await buildLuminanceBase(file);
      dispatch({ type: 'source', asset: { kind: 'image', name: file.name, mimeType: file.type, dataUrl: await fileToDataUrl(file), sizeBytes: file.size } });
      if (!options.keepRelief) {
        dispatch({ type: 'reliefBase', base, mask: null });
        // A wall plane fitted to the last photo would slice into this one; start it flat against the back.
        setRelief(options.keepTuning ? { source: 'luminance' } : { source: 'luminance', depthFloor: 0 });
      }
      dispatch({ type: 'step', value: 'source' });
      dispatch({ type: 'busy', label: null, progress: 100, status: `Loaded ${file.name}. Next: estimate depth, then cut out the subject.` });
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, [dispatch, say, setRelief]);

  const loadSample = useCallback(async () => {
    dispatch({ type: 'busy', label: 'Loading sample', progress: 10, status: 'Fetching the sample head…' });
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/test-head.stl`);
      if (!res.ok) throw new Error(`Sample not found (${res.status})`);
      await loadMesh(new File([await res.blob()], 'sample-head.stl', { type: 'model/stl' }));
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, [dispatch, loadMesh, say]);

  const photoBlob = useCallback(() => sourceAsset?.kind === 'image' && sourceAsset.dataUrl ? dataUrlToFile(sourceAsset.dataUrl, sourceAsset.name) : null, [sourceAsset]);

  const runDepth = useCallback(async () => {
    const file = photoBlob();
    if (!file || !reliefBase) return say('Add a photo first.');
    if (!aiSupported()) return say('This browser cannot run the depth model (it needs Web Workers and OffscreenCanvas).');
    dispatch({ type: 'busy', label: 'Estimating depth', progress: 1, status: `Starting the depth model on ${webGpuAvailable() ? 'the GPU' : 'the CPU (slower)'}…` });
    try {
      const out = await estimateDepth(file, (progress, status) => dispatch({ type: 'busy', label: 'Estimating depth', progress, status }));
      const values = resampleGrid(normalizeDepth(out.values), out.width, out.height, reliefBase.width, reliefBase.height);
      const base: ReliefBase = { source: 'depth', width: reliefBase.width, height: reliefBase.height, values };
      dispatch({ type: 'reliefBase', base });
      setRelief({ source: 'depth' });
      dispatch({ type: 'busy', label: null, progress: 100, status: `Depth estimated on ${out.device}.${mask ? '' : ' Next: cut out the subject, or paint the mask by hand.'}` });
    } catch (e) { say(failure('Depth', e)); }
  }, [dispatch, mask, photoBlob, reliefBase, say, setRelief]);

  const runCutout = useCallback(async () => {
    const file = photoBlob();
    if (!file || !reliefBase) return say('Add a photo first.');
    if (!aiSupported()) return say('This browser cannot run the cutout model (it needs Web Workers and OffscreenCanvas).');
    dispatch({ type: 'busy', label: 'Cutting out subject', progress: 1, status: 'Starting the background removal model…' });
    try {
      const out = await removeBackground(file, (progress, status) => dispatch({ type: 'busy', label: 'Cutting out subject', progress, status }));
      const m = maskFromAlpha(out.alpha, out.width, out.height, reliefBase.width, reliefBase.height);
      dispatch({ type: 'mask', mask: m });
      const floor = reliefBase.source === 'depth' ? suggestFloor(reliefBase, m, settings.relief) : settings.relief.depthFloor;
      if (floor !== settings.relief.depthFloor) setRelief({ depthFloor: floor });
      dispatch({ type: 'busy', label: null, progress: 100, status: `Subject cut out with ${out.model} on ${out.device}. Check the edges and paint over anything it missed.` });
    } catch (e) { say(failure('Cutout', e)); }
  }, [dispatch, photoBlob, reliefBase, say, setRelief, settings.relief]);

  const thresholdMask = useCallback(() => { if (reliefBase) dispatch({ type: 'mask', mask: maskFromThreshold(reliefBase, settings.relief.backgroundThreshold) }); }, [dispatch, reliefBase, settings.relief.backgroundThreshold]);
  const clearMask = useCallback(() => dispatch({ type: 'mask', mask: null }), [dispatch]);

  const generate = useCallback(async (): Promise<GenerateOutcome> => {
    const photo = settings.inputMode === 'relief';
    if (!sourceReady({ settings, mesh, reliefBase })) {
      say(photo ? 'Add your photo first.' : 'Add your 3D model first.');
      dispatch({ type: 'step', value: 'source' });
      return 'needs-input';
    }
    const count = nominalCount(settings);
    if (count > LAYER_SOFT_LIMIT && !window.confirm(`This will cut up to ${count} pieces. Continue?`)) return 'cancelled';
    dispatch({ type: 'busy', label: 'Generating slices', progress: 10, status: 'Slicing, placing rods and nesting the sheets…' });
    try {
      // Let the overlay paint before the heavy synchronous geometry pass.
      await new Promise(r => setTimeout(r, 30));
      const output = await buildResult({ settings, mesh, reliefBase, mask });
      dispatch({ type: 'result', result: output });
      dispatch({ type: 'step', value: 'slices' });
      const pieces = pieceCount(output);
      dispatch({ type: 'busy', label: null, progress: 100, status: `Generated ${pieces} ${output.buildMode === 'slabs' ? 'slabs' : 'layers'} on ${output.sheets.length} sheet${output.sheets.length === 1 ? '' : 's'}.` });
      return 'done';
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
      return 'failed';
    }
  }, [dispatch, mask, mesh, reliefBase, say, settings]);

  const saveProject = useCallback(() => {
    const project = makeProject(projectName, settings, sourceAsset, result, { base: reliefBase, mask });
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${projectName || 'stackcarve'}.stackcarve.json`);
    dispatch({ type: 'saved' });
    say('Project saved to your downloads.');
  }, [dispatch, mask, projectName, reliefBase, result, say, settings, sourceAsset]);

  const loadProject = useCallback(async (file: File) => {
    try {
      const project = parseProject(await file.text());
      // Another project is another piece: the pictures and idea on the bench belong to the last one.
      clearTray(true);
      dispatch({ type: 'project', project });
      const stored = decodeRelief(project.relief);
      if (project.sourceAsset?.dataUrl) {
        const f = dataUrlToFile(project.sourceAsset.dataUrl, project.sourceAsset.name);
        if (project.sourceAsset.kind === 'mesh') await loadMesh(f); else await loadPhoto(f, { keepRelief: !!stored.base, keepTuning: true });
      }
      if (stored.base) dispatch({ type: 'reliefBase', base: stored.base, mask: stored.mask });
      dispatch({ type: 'saved' });
      dispatch({ type: 'step', value: 'plan' });
      say(`Opened ${project.name}. Check the plan, then generate.`);
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, [clearTray, dispatch, loadMesh, loadPhoto, say]);

  const newProject = useCallback(() => {
    if ((unsavedAi || result) && !window.confirm('Start a new project? Anything not saved is lost.')) return;
    void clearAutosave();
    setRestorable(null);
    clearTray(true);
    dispatch({ type: 'reset' });
  }, [clearTray, dispatch, result, unsavedAi]);

  const exportZip = useCallback(() => { if (result) void exportAll(projectName, result, settings, sourceAsset); }, [projectName, result, settings, sourceAsset]);

  const setStyle = useCallback((id: StyleId) => {
    const style = STYLES.find(s => s.id === id);
    if (style) patchSettings(style.apply(settings));
  }, [patchSettings, settings]);

  const setSource = useCallback((kind: 'photo' | 'model') => {
    // A statue cannot come from a flat photo, so switching to a photo falls back to the face plaque.
    if (kind === 'photo') patchSettings({ ...(settings.buildMode === 'statue' ? STYLES.find(s => s.id === 'plaque')!.apply(settings) : {}), inputMode: 'relief' });
    else patchSettings({ inputMode: 'mesh' });
  }, [patchSettings, settings]);

  const loadAny = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    if (/\.(stl|obj|glb)$/.test(name)) { if (settings.inputMode === 'relief') patchSettings({ inputMode: 'mesh' }); return loadMesh(file); }
    if (/\.json$/.test(name)) return loadProject(file);
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/.test(name)) {
      if (settings.inputMode !== 'relief') setSource('photo');
      return addImages([file]);
    }
    say(`${file.name} is not a photo, a 3D model or a StackCarve project.`);
  }, [addImages, loadMesh, loadProject, patchSettings, say, setSource, settings.inputMode]);

  const loadDropped = useCallback((data: DataTransfer | null) => {
    const files = Array.from(data?.files ?? []);
    if (!files.length) {
      // Dragged straight out of another web page, a picture can arrive as nothing but its address.
      if (data?.types.includes('text/uri-list')) say('That picture came across as a link. Copy the image and paste it here instead.');
      return;
    }
    const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name);
    const images = files.filter(isImage);
    const other = files.find(f => !isImage(f));
    if (other) { void loadAny(other); return; }
    if (settings.inputMode !== 'relief') setSource('photo');
    void addImages(images);
  }, [addImages, loadAny, say, setSource, settings.inputMode]);

  const generateWithMeshy = useCallback(async (image: File | null, apiKey: string) => {
    const file = image ?? photoBlob();
    if (!file) return say('Choose a photo of the statue first.');
    if (!apiKey.trim()) return say('Paste a Meshy API key first.');
    localStorage.setItem('stackcarve.meshy.apiKey', apiKey.trim());
    patchSettings({ ai: { ...settings.ai, apiKeyPresent: true } });
    dispatch({ type: 'busy', label: 'Making a 3D model', progress: 1, status: 'Sending the photo to Meshy…' });
    try {
      const glb = await MeshyProvider.generate(file, { apiKey: apiKey.trim(), proxyUrl: settings.ai.proxyUrl, modelType: settings.ai.modelType, targetPolycount: settings.ai.targetPolycount, onProgress: (progress, status) => dispatch({ type: 'busy', label: 'Making a 3D model', progress, status }) });
      const loaded = await loadMeshFromArrayBuffer(glb, 'meshy-generated.glb');
      const generated = new File([glb], 'meshy-generated.glb', { type: 'model/gltf-binary' });
      dispatch({ type: 'source', asset: { kind: 'mesh', name: generated.name, mimeType: generated.type, dataUrl: await fileToDataUrl(generated), sizeBytes: generated.size }, mesh: loaded });
      dispatch({ type: 'busy', label: null, progress: 100, status: 'Model made and loaded. It is saved inside the project file.' });
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, [dispatch, patchSettings, photoBlob, say, settings.ai]);

  // Crash insurance: keep the photo session in IndexedDB and offer it back after a reload.
  useEffect(() => { void readAutosave().then(rec => { if (rec?.relief?.base) setRestorable(rec); }); }, []);
  useEffect(() => {
    if (!reliefBase) return;
    scheduleAutosave({ projectName, settings, sourceAsset, base: reliefBase, mask });
  }, [projectName, settings, sourceAsset, reliefBase, mask]);
  // Leaving for ChatGPT hides this tab; write the session at once instead of trusting a timer in a hidden tab.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushAutosave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushAutosave);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flushAutosave); };
  }, []);

  const restoreSession = useCallback(async () => {
    if (!restorable) return;
    const { base, mask: m } = decodeAutosaveRelief(restorable);
    // Sessions saved by older builds lack newer settings; fill them in before use.
    const saved = mergeSettings(restorable.settings);
    dispatch({ type: 'project', project: { schemaVersion: 1, name: restorable.projectName, settings: saved, sourceAsset: restorable.sourceAsset, placements: [], createdAt: restorable.savedAt, updatedAt: restorable.savedAt } });
    if (base) dispatch({ type: 'reliefBase', base, mask: m });
    setRestorable(null);
    const when = new Date(restorable.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (base && saved.inputMode === 'relief') {
      // Slices are cheap to rebuild, so bring the session back exactly where it was.
      dispatch({ type: 'busy', label: 'Restoring session', progress: 10, status: 'Rebuilding slices from the saved depth and cutout…' });
      await new Promise(r => setTimeout(r, 30));
      try {
        const output = await buildResult({ settings: saved, mesh: null, reliefBase: base, mask: m });
        dispatch({ type: 'result', result: output });
        dispatch({ type: 'step', value: 'slices' });
        dispatch({ type: 'busy', label: null, progress: 100, status: `Restored the session from ${when} and rebuilt ${pieceCount(output)} pieces. Save the project to keep it for good.` });
        return;
      } catch (e) {
        dispatch({ type: 'step', value: 'source' });
        return say(`Restored the session; generate when ready (${e instanceof Error ? e.message : String(e)}).`);
      }
    }
    dispatch({ type: 'step', value: 'source' });
    say(`Restored the session from ${when}. Save the project to keep it for good.`);
  }, [dispatch, restorable, say]);

  const discardSession = useCallback(() => {
    // Only that session's photo leaves the tray; other pictures waiting there are not part of it.
    const photo = restorable?.sourceAsset?.kind === 'image' ? restorable.sourceAsset.dataUrl : null;
    if (photo) forgetPicture(photo);
    setRestorable(null);
    void clearAutosave();
  }, [forgetPicture, restorable]);

  const value = useMemo<Actions>(() => ({
    pickPhoto: () => photoInput.current?.click(),
    pickMesh: () => meshInput.current?.click(),
    pickProject: () => projectInput.current?.click(),
    loadPhoto, loadMesh, loadSample, loadAny, loadDropped, runDepth, runCutout, thresholdMask, clearMask, generate,
    saveProject, newProject, exportZip, setStyle, setSource, generateWithMeshy,
    restorable, restoreSession, discardSession
  }), [loadPhoto, loadMesh, loadSample, loadAny, loadDropped, runDepth, runCutout, thresholdMask, clearMask, generate, saveProject, newProject, exportZip, setStyle, setSource, generateWithMeshy, restorable, restoreSession, discardSession]);

  const pick = (load: (f: File) => unknown) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again should still fire
    if (f) void load(f);
  };

  return <Ctx.Provider value={value}>
    {children}
    <input ref={photoInput} id="photo-file" hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // choosing the same file again should still fire
      if (files.length) void addImages(files);
    }}/>
    <input ref={meshInput} id="mesh-file" hidden type="file" accept=".stl,.obj,.glb" onChange={pick(loadMesh)}/>
    <input ref={projectInput} id="project-file" hidden type="file" accept=".json" onChange={pick(loadProject)}/>
  </Ctx.Provider>;
}

export function useActions() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useActions must be inside ActionsProvider');
  return value;
}
