import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { NumberField } from './NumberField';
import { loadMeshFile, loadMeshFromArrayBuffer } from '../mesh/loadMesh';
import { buildLuminanceBase, composeHeightmap, maskFromAlpha, maskFromThreshold, normalizeDepth, resampleGrid, suggestFloor } from '../relief/heightmap';
import { aiSupported, estimateDepth, removeBackground, webGpuAvailable } from '../relief/ai';
import { fileToDataUrl, dataUrlToFile, downloadBlob } from '../utils/files';
import { runPipeline } from '../engine/pipeline';
import { MeshyProvider } from '../providers/meshy';
import { decodeRelief, makeProject, parseProject } from '../export/project';
import { INPUT_PRESETS, LAYER_SOFT_LIMIT, MODE_PRESETS, SHEET_PRESETS, THICKNESS_PRESETS } from '../defaults';
import { measureOriented } from '../mesh/measure';
import type { BuildMode, ProjectSettings, ReliefBase } from '../types';

const MODE_LABEL: Record<BuildMode, string> = { statue: 'Statue', terraced: 'Wall art: terraced', slabs: 'Wall art: slabs' };
const MODE_NOTE: Record<BuildMode, string> = {
  statue: 'Free-standing stack. Slices run across the chosen axis and every layer gets two dowels.',
  terraced: 'Layers lie parallel to the wall like a topo map. Short pins between neighbours, hidden where the next layer covers them.',
  slabs: 'Horizontal slabs stacked bottom to top with a flat back. Two rods run through a hidden strip along the back edge.'
};

type SectionId = 'input' | 'build' | 'scale' | 'depth' | 'hollow' | 'pins' | 'sheets' | 'ai';
const DEFAULT_OPEN: Record<SectionId, boolean> = { input: true, build: true, scale: true, depth: true, hollow: false, pins: false, sheets: false, ai: true };

function Section({ id, title, summary, open, toggle, children }: { id: SectionId; title: string; summary?: string; open: boolean; toggle: (id: SectionId) => void; children: React.ReactNode }) {
  return <section className={open ? 'open' : 'closed'}>
    <button type="button" className="section-head" onClick={() => toggle(id)} aria-expanded={open}>
      <h3>{title}</h3>
      {!open && summary && <small>{summary}</small>}
      <i>{open ? '▾' : '▸'}</i>
    </button>
    {open && children}
  </section>;
}

export const PRESETS: { id: string; label: string; hint: string; apply: (s: ProjectSettings) => Partial<ProjectSettings> }[] = [
  {
    id: 'plaque', label: 'Face plaque', hint: 'Terraced, 1/4 in, 2.5 in deep',
    apply: s => ({ buildMode: 'terraced', materialThickness: 0.25, hollowEnabled: true, wallThickness: 0.75, overlapMargin: 0.375, minFeature: 0.25, partGap: 0.3,
      relief: { ...s.relief, depth: 2.5, baseDepth: 1 }, wallArt: { ...s.wallArt, slabGap: 0, basePlate: true, reliefDepth: s.inputMode === 'relief' ? s.wallArt.reliefDepth : 6 } })
  },
  {
    id: 'lineart', label: 'Line-art slabs', hint: 'Vertical slabs, 1/4 in gap, hollowing off',
    apply: s => ({ buildMode: 'slabs', materialThickness: 0.25, hollowEnabled: false, minFeature: 0.25, partGap: 0.3,
      relief: { ...s.relief, depth: 3, baseDepth: 1 }, wallArt: { ...s.wallArt, slabDirection: 'vertical', slabGap: 0.25, backerPlate: true, backZoneDepth: 1 } })
  },
  {
    id: 'stack', label: 'Solid slabs', hint: 'Horizontal slabs, touching, rods',
    apply: s => ({ buildMode: 'slabs', materialThickness: 0.25, hollowEnabled: true, wallThickness: 0.75, overlapMargin: 0.375, minFeature: 0.25, partGap: 0.3,
      relief: { ...s.relief, depth: 3, baseDepth: 1 }, wallArt: { ...s.wallArt, slabDirection: 'horizontal', slabGap: 0, backerPlate: false } })
  },
  {
    id: 'statue', label: 'Statue', hint: 'Needs a 3D model; 3/4 in, hollow',
    apply: () => ({ inputMode: 'mesh', buildMode: 'statue', materialThickness: 0.75, hollowEnabled: true, wallThickness: 0.75, overlapMargin: 0.5, minFeature: 0.125, partGap: 0.5, targetHeight: 12 })
  }
];

export function ControlPanel({ projectName, setProjectName }: { projectName: string; setProjectName: (s:string)=>void }) {
  const store = useStore();
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);
  const toggle = (id: SectionId) => setOpenSections(o => ({ ...o, [id]: !o[id] }));
  const isOpen = (id: SectionId) => openSections[id];
  const { settings, patchSettings, sourceAsset, mesh, reliefBase, mask, result, dispatch, unsavedAi } = store;
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('stackcarve.meshy.apiKey') ?? '');
  const [aiImage, setAiImage] = useState<File | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const setRelief = (patch: Partial<typeof settings.relief>) => patchSettings({ relief: { ...settings.relief, ...patch } });
  const setAi = (patch: Partial<typeof settings.ai>) => patchSettings({ ai: { ...settings.ai, ...patch } });
  const setWall = (patch: Partial<typeof settings.wallArt>) => patchSettings({ wallArt: { ...settings.wallArt, ...patch } });
  const setMode = (buildMode: BuildMode) => patchSettings({ buildMode, ...MODE_PRESETS[buildMode] });
  const rotate = (patch: Partial<typeof settings.rotationDeg>) => patchSettings({ rotationDeg: { ...settings.rotationDeg, ...patch } });

  const relief = settings.inputMode === 'relief';
  const mode: BuildMode = relief ? (settings.buildMode === 'slabs' ? 'slabs' : 'terraced') : settings.buildMode;
  const wallArt = mode !== 'statue';
  const t = settings.materialThickness;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const rotKey = `${settings.rotationDeg.x},${settings.rotationDeg.y},${settings.rotationDeg.z}`;
  // Size of the model at the requested height, so relief depth can be chosen with the real depth in view.
  const scaled = useMemo(() => {
    if (!mesh || relief) return null;
    const m = measureOriented(mesh.geometry, settings.rotationDeg);
    if (m.height <= 0) return null;
    const k = settings.targetHeight / m.height;
    return { width: m.width * k, depth: m.depth * k * (wallArt ? settings.wallArt.depthScale : 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, rotKey, settings.targetHeight, settings.wallArt.depthScale, wallArt, relief]);
  const keptDepth = scaled ? (settings.wallArt.reliefDepth > 0 ? Math.min(settings.wallArt.reliefDepth, scaled.depth) : scaled.depth) : settings.wallArt.reliefDepth;
  const pitch = t + (mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0);
  const reliefHeight = reliefBase ? settings.relief.finishedWidth * (reliefBase.height - 1) / Math.max(1, reliefBase.width - 1) : settings.relief.finishedWidth;
  const stackSpan = mode === 'slabs'
    ? (relief ? (settings.wallArt.slabDirection === 'horizontal' ? reliefHeight : settings.relief.finishedWidth) : (settings.wallArt.slabDirection === 'horizontal' ? settings.targetHeight : (scaled?.width ?? settings.targetHeight)))
    : (mode === 'terraced' ? (relief ? settings.relief.depth : keptDepth) : settings.targetHeight);
  const count = Math.max(1, Math.round((stackSpan + (mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0)) / pitch));

  const loadMesh = async (file: File) => {
    dispatch({type:'busy',label:'Loading mesh',progress:15,status:'Welding vertices and checking topology…'});
    try {
      const loaded = await loadMeshFile(file);
      dispatch({type:'mesh',mesh:loaded});
      dispatch({type:'source',asset:{kind:'mesh',name:file.name,mimeType:file.type||'application/octet-stream',dataUrl:await fileToDataUrl(file),sizeBytes:file.size},mesh:loaded});
      dispatch({type:'busy',label:null,progress:100,status:`Loaded ${file.name}.`});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const loadPhoto = async (file: File, keepRelief = false) => {
    dispatch({type:'busy',label:'Processing photo',progress:20,status:'Reading photo…'});
    try {
      const base = await buildLuminanceBase(file);
      if (!keepRelief) dispatch({type:'reliefBase',base,mask:null});
      dispatch({type:'source',asset:{kind:'image',name:file.name,mimeType:file.type,dataUrl:await fileToDataUrl(file),sizeBytes:file.size}});
      if (!keepRelief && settings.inputMode==='relief') setRelief({source:'luminance'});
      dispatch({type:'busy',label:null,progress:100,status:`Loaded ${file.name}. ${settings.inputMode==='relief'?'Next: Estimate depth, then Cut out subject.':''}`});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const photoBlob = () => sourceAsset?.kind==='image' && sourceAsset.dataUrl ? dataUrlToFile(sourceAsset.dataUrl, sourceAsset.name) : null;

  const runDepth = async () => {
    const file = photoBlob();
    if (!file || !reliefBase) return dispatch({type:'busy',label:null,status:'Load a photo first.'});
    if (!aiSupported()) return dispatch({type:'busy',label:null,status:'This browser cannot run the depth model (needs Web Workers and OffscreenCanvas).'});
    dispatch({type:'busy',label:'Estimating depth',progress:1,status:`Starting the depth model on ${webGpuAvailable()?'the GPU':'the CPU (slower)'}…`});
    try {
      const out = await estimateDepth(file,(progress,status)=>dispatch({type:'busy',label:'Estimating depth',progress,status}));
      const normalized = normalizeDepth(out.values);
      const values = resampleGrid(normalized, out.width, out.height, reliefBase.width, reliefBase.height);
      const base: ReliefBase = { source:'depth', width: reliefBase.width, height: reliefBase.height, values };
      dispatch({type:'reliefBase',base});
      setRelief({source:'depth'});
      dispatch({type:'busy',label:null,progress:100,status:`Depth estimated on ${out.device}. ${mask?'':'Next: Cut out subject, or paint the mask by hand.'}`});
    } catch(e) { dispatch({type:'busy',label:null,status:`Depth failed: ${e instanceof Error?e.message:String(e)}. The model downloads from huggingface.co and cdn.jsdelivr.net on first use; check the connection and try again.`}); }
  };

  const runCutout = async () => {
    const file = photoBlob();
    if (!file || !reliefBase) return dispatch({type:'busy',label:null,status:'Load a photo first.'});
    if (!aiSupported()) return dispatch({type:'busy',label:null,status:'This browser cannot run the cutout model (needs Web Workers and OffscreenCanvas).'});
    dispatch({type:'busy',label:'Cutting out subject',progress:1,status:'Starting the background removal model…'});
    try {
      const out = await removeBackground(file,(progress,status)=>dispatch({type:'busy',label:'Cutting out subject',progress,status}));
      const m = maskFromAlpha(out.alpha, out.width, out.height, reliefBase.width, reliefBase.height);
      dispatch({type:'mask',mask:m});
      const floor = reliefBase.source === 'depth' ? suggestFloor(reliefBase, m, settings.relief) : settings.relief.depthFloor;
      if (floor !== settings.relief.depthFloor) setRelief({depthFloor:floor});
      dispatch({type:'busy',label:null,progress:100,status:`Subject cut out on ${out.device}. Wall plane set to ${floor.toFixed(2)} so the subject uses the full relief depth. Paint over anything the cutout missed in the Photo tab.`});
    } catch(e) { dispatch({type:'busy',label:null,status:`Cutout failed: ${e instanceof Error?e.message:String(e)}. The model downloads from huggingface.co and cdn.jsdelivr.net on first use; check the connection and try again.`}); }
  };

  const loadSample = async () => {
    dispatch({type:'busy',label:'Loading sample',progress:10,status:'Fetching the sample head…'});
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/test-head.stl`);
      if (!res.ok) throw new Error(`Sample not found (${res.status})`);
      const blob = await res.blob();
      await loadMesh(new File([blob], 'sample-head.stl', { type: 'model/stl' }));
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const depthDone = reliefBase?.source === 'depth';
  const photoSteps = [
    { label: 'Photo', done: !!reliefBase },
    { label: 'Depth', done: depthDone },
    { label: 'Cut out', done: !!mask },
    { label: 'Build', done: !!result }
  ];
  const nextStep = photoSteps.findIndex(s => !s.done);

  const thresholdMask = () => { if (reliefBase) dispatch({type:'mask',mask:maskFromThreshold(reliefBase, settings.relief.backgroundThreshold)}); };
  const clearMask = () => dispatch({type:'mask',mask:null});

  const generate = async () => {
    if (relief && !reliefBase) return dispatch({type:'busy',label:null,status:'Load a photo first (Input section).'});
    if (!relief && !mesh) return dispatch({type:'busy',label:null,status:'Load a mesh first (Input section).'});
    if (count > LAYER_SOFT_LIMIT && !window.confirm(`This will generate about ${count} pieces. Continue?`)) return;
    dispatch({type:'busy',label:'Generating cut geometry',progress:10,status:'Sectioning and rebuilding contours…'});
    try {
      const map = relief && reliefBase ? composeHeightmap(reliefBase, { settings: settings.relief, mask, preview: false }) : null;
      // Let the overlay paint before the heavy synchronous geometry pass.
      await new Promise(r => setTimeout(r, 30));
      const output = await runPipeline({settings,mesh,heightmap:map});
      dispatch({type:'result',result:output});
      dispatch({type:'tab',value:'slices'});
      const pieces = output.layers.filter(l => l.parts.some(p => p.role !== 'backer')).length;
      dispatch({type:'busy',label:null,progress:100,status:`Generated ${pieces} ${output.buildMode === 'slabs' ? 'slabs' : 'layers'} on ${output.sheets.length} sheet${output.sheets.length===1?'':'s'} (${output.stockSheets} × 4×8 stock).`});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const generateAi = async () => {
    const file = aiImage ?? (sourceAsset?.kind==='image' && sourceAsset.dataUrl ? dataUrlToFile(sourceAsset.dataUrl,sourceAsset.name) : null);
    if (!file) return dispatch({type:'busy',label:null,status:'Choose a source photo for AI image-to-3D.'});
    if (!apiKey.trim()) return dispatch({type:'busy',label:null,status:'Paste a Meshy API key in Settings.'});
    localStorage.setItem('stackcarve.meshy.apiKey', apiKey.trim()); setAi({apiKeyPresent:true});
    dispatch({type:'busy',label:'AI image to 3D',progress:1,status:'Submitting task…'});
    try {
      const glb = await MeshyProvider.generate(file,{apiKey:apiKey.trim(),proxyUrl:settings.ai.proxyUrl,modelType:settings.ai.modelType,targetPolycount:settings.ai.targetPolycount,onProgress:(progress,status)=>dispatch({type:'busy',label:'AI image to 3D',progress,status})});
      const loaded = await loadMeshFromArrayBuffer(glb,'meshy-generated.glb');
      const generatedFile = new File([glb], 'meshy-generated.glb', { type: 'model/gltf-binary' });
      dispatch({type:'source',asset:{kind:'mesh',name:generatedFile.name,mimeType:generatedFile.type,dataUrl:await fileToDataUrl(generatedFile),sizeBytes:generatedFile.size},mesh:loaded});
      dispatch({type:'busy',label:null,progress:100,status:'Generated GLB loaded and embedded in the project save.'});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const saveProject = () => { downloadBlob(new Blob([JSON.stringify(makeProject(projectName,settings,sourceAsset,result,{base:reliefBase,mask}),null,2)],{type:'application/json'}),`${projectName||'stackcarve'}.stackcarve.json`); dispatch({type:'saved'}); };
  const applyPreset = (id: string) => {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;
    const patch = preset.apply(settings);
    patchSettings(patch);
    dispatch({type:'busy',label:null,status:`${preset.label} preset applied (${preset.hint}).${patch.inputMode==='mesh'&&settings.inputMode!=='mesh'?' Switched to Mesh input: a statue needs a 3D model.':''}`});
  };
  const loadProject = async (file: File) => {
    try {
      const project=parseProject(await file.text()); setProjectName(project.name); dispatch({type:'project',project});
      const stored = decodeRelief(project.relief);
      if(project.sourceAsset?.dataUrl){const f=dataUrlToFile(project.sourceAsset.dataUrl,project.sourceAsset.name);if(project.sourceAsset.kind==='mesh')await loadMesh(f);else await loadPhoto(f, !!stored.base);}
      if (stored.base) dispatch({type:'reliefBase',base:stored.base,mask:stored.mask});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  return <aside className="controls">
    <div className="project-row"><input className="project-name" value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Project name"/><button onClick={saveProject}>Save</button><button onClick={()=>projectInput.current?.click()}>Load</button><input ref={projectInput} hidden type="file" accept=".json" onChange={e=>e.target.files?.[0]&&loadProject(e.target.files[0])}/></div>
    {unsavedAi&&<div className="banner"><span>Depth and mask live only in this tab until you save the project.</span><button onClick={saveProject}>Save now</button></div>}
    <div className="presets"><span>Start from</span>{PRESETS.map(p=><button key={p.id} className="chip" title={p.hint} onClick={()=>applyPreset(p.id)}>{p.label}</button>)}</div>

    <Section id="input" title="Input" summary={settings.inputMode==='mesh'?(mesh?.sourceName??'no mesh'):settings.inputMode==='relief'?(sourceAsset?.name??'no photo'):'AI statue'} open={isOpen('input')} toggle={toggle}><div className="segmented">{(['mesh','relief','ai'] as const).map(m=><button className={settings.inputMode===m?'active':''} key={m} onClick={()=>patchSettings({inputMode:m,...(m==='relief'&&settings.inputMode!=='relief'?{...INPUT_PRESETS.relief,buildMode:settings.buildMode==='statue'?'terraced':settings.buildMode}:{})})}>{m==='mesh'?'Mesh':m==='relief'?'Photo':'AI statue'}</button>)}</div>
      {settings.inputMode==='mesh'&&<><label className="drop"><input type="file" accept=".stl,.obj,.glb" onChange={e=>e.target.files?.[0]&&loadMesh(e.target.files[0])}/><b>Load STL, OBJ, or GLB</b><span>{mesh?.sourceName??'No mesh loaded'}</span></label>
        {!mesh&&<button className="link-btn" onClick={loadSample}>No model handy? Try the sample head</button>}</>}
      {relief&&<><div className="steps">{photoSteps.map((st,i)=><span key={st.label} className={st.done?'done':i===nextStep?'next':''}>{st.done?'✓ ':`${i+1}. `}{st.label}</span>)}</div>
        <label className="drop"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>e.target.files?.[0]&&loadPhoto(e.target.files[0])}/><b>Load a photo</b><span>{sourceAsset?.kind==='image'?sourceAsset.name:'Head-on, filling the frame, plain background'}</span></label>
        <div className="btn-row"><button className={depthDone?'done':'primary'} disabled={!reliefBase} onClick={runDepth}>{depthDone?'✓ Depth ready (redo)':'1. Estimate depth (AI)'}</button><button className={mask?'done':'primary'} disabled={!reliefBase} onClick={runCutout}>{mask?'✓ Cut out (redo)':'2. Cut out subject (AI)'}</button></div>
        <div className="btn-row"><button disabled={!reliefBase} onClick={thresholdMask}>Mask from threshold</button><button disabled={!mask} onClick={clearMask}>Clear mask</button></div>
        <p className="note">Models download once (roughly 50 to 150 MB total) and run on this computer. Paint the mask in the Photo tab. The cutout model (RMBG-1.4) is licensed for non-commercial use.</p></>}
      {settings.inputMode==='ai'&&<><label className="drop"><input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f){setAiImage(f);loadPhoto(f)}}}/><b>Load statue photo</b><span>{aiImage?.name??(sourceAsset?.kind==='image'?sourceAsset.name:'No image loaded')}</span></label><button className="primary full" onClick={generateAi}>Generate GLB with Meshy</button></>}
    </Section>

    <Section id="build" title="Build" summary={MODE_LABEL[mode]} open={isOpen('build')} toggle={toggle}>
      {relief
        ? <>
          <div className="segmented vertical">{(['terraced','slabs'] as const).map(m=><button className={mode===m?'active':''} key={m} onClick={()=>setMode(m)}>{MODE_LABEL[m]}</button>)}</div>
          <p className="note">{mode==='terraced'?'Depth is quantised into terraces; layer 1 is the full silhouette against the wall.':'Each slab is the depth profile along one band of the photo, closed at a flat back.'}</p>
        </>
        : <>
          <div className="segmented vertical">{(['statue','terraced','slabs'] as const).map(m=><button className={settings.buildMode===m?'active':''} key={m} onClick={()=>setMode(m)}>{MODE_LABEL[m]}</button>)}</div>
          <p className="note">{MODE_NOTE[settings.buildMode]}</p>
        </>}
    </Section>

    <Section id="scale" title="Scale & layers" summary={`${count} ${mode==='slabs'?'slabs':'layers'} · ${t} in stock`} open={isOpen('scale')} toggle={toggle}>
      {relief&&<NumberField label="Finished width on wall" value={settings.relief.finishedWidth} min={1} onChange={n=>setRelief({finishedWidth:n})}/>}
      {relief&&reliefBase&&<div className="computed"><span>Finished height</span><b>{(settings.relief.finishedWidth*(reliefBase.height-1)/Math.max(1,reliefBase.width-1)).toFixed(1)} in</b></div>}
      {relief
        ? <NumberField label="Relief depth (nose off the wall)" value={settings.relief.depth} min={.1} onChange={n=>setRelief({depth:n})}/>
        : <NumberField label={wallArt?'Finished height on wall':'Target height'} value={settings.targetHeight} min={.1} onChange={n=>patchSettings({targetHeight:n})}/>}
      {relief&&<p className="note">A face plaque usually wants 2 to 4 in of depth for a 20 in wide piece. Depth divided by thickness is the layer count.</p>}
      {wallArt&&!relief&&<>
        {scaled&&<div className="computed"><span>Model at this height</span><b>{scaled.width.toFixed(1)} wide × {scaled.depth.toFixed(1)} deep</b></div>}
        <NumberField label="Relief depth kept from the front (0 = all)" value={settings.wallArt.reliefDepth} min={0} onChange={n=>setWall({reliefDepth:n})}/>
        <NumberField label="Depth compression" value={settings.wallArt.depthScale} min={.1} max={1} step={.05} suffix="×" onChange={n=>setWall({depthScale:Math.min(1,Math.max(.1,n))})}/>
        {scaled&&<p className="note">The wall plane sits {keptDepth.toFixed(1)} in behind the nose; anything deeper is cut away. A face usually wants the front 40 to 60% of the head.</p>}
      </>}
      <NumberField label="Material thickness (measure it)" value={t} min={.05} step={.001} onChange={n=>patchSettings({materialThickness:n})}/>
      <div className="chips">{THICKNESS_PRESETS.map(p=><button key={p.label} className={near(t,p.value)?'chip active':'chip'} onClick={()=>patchSettings({materialThickness:p.value})}>{p.label}</button>)}</div>
      <div className={count>LAYER_SOFT_LIMIT?'computed alert':'computed'}><span>{mode==='slabs'?'Slab count (before trimming)':'Layer count'}</span><b>{count}{count>LAYER_SOFT_LIMIT?' (a lot)':''}</b></div>
      {count>LAYER_SOFT_LIMIT&&<p className="note alert">{count} pieces will take a while to cut and glue. Thicker stock, a bigger gap, or less relief depth brings it down.</p>}
      <div className="computed"><span>{mode==='terraced'?'Achieved depth':mode==='slabs'?(settings.wallArt.slabDirection==='horizontal'?'Stack height':'Stack width'):'Achieved height'}</span><b>{(count*pitch-(mode==='slabs'?Math.max(0,settings.wallArt.slabGap):0)).toFixed(3)} in</b></div>
      {mode==='terraced'&&!relief&&<label className="toggle"><input type="checkbox" checked={settings.wallArt.basePlate} onChange={e=>setWall({basePlate:e.target.checked})}/><span>Base plate: back layer becomes the full silhouette</span></label>}
      {mode==='slabs'&&<>
        <label className="field"><span>Slab direction</span><select value={settings.wallArt.slabDirection} onChange={e=>setWall({slabDirection:e.target.value as 'horizontal'|'vertical'})}><option value="horizontal">Horizontal (stack bottom to top)</option><option value="vertical">Vertical (stack left to right)</option></select></label>
        <NumberField label="Gap between slabs (0 = touching)" value={settings.wallArt.slabGap} min={0} step={.0625} onChange={n=>setWall({slabGap:Math.max(0,n)})}/>
        {settings.wallArt.slabGap>0&&<p className="note">Gaps give the line-art look and cut wood use roughly in half. Keep the spacing with printed sleeves or nuts on threaded rod; the Sheets tab lists them.</p>}
        {relief&&<NumberField label="Base depth inside the silhouette" value={settings.relief.baseDepth} min={0} onChange={n=>setRelief({baseDepth:n})}/>}
        <NumberField label="Hidden back zone depth" value={settings.wallArt.backZoneDepth} min={.2} onChange={n=>setWall({backZoneDepth:n})}/>
        <NumberField label="Rod hole diameter" value={settings.wallArt.rodHoleDiameter} min={.05} step={.001} onChange={n=>setWall({rodHoleDiameter:n})}/>
        <label className="toggle"><input type="checkbox" checked={settings.wallArt.backerPlate} onChange={e=>setWall({backerPlate:e.target.checked})}/><span>Add silhouette backer plate for hanging</span></label>
      </>}
      {!relief&&<>
        {!wallArt&&<label className="field"><span>Slice axis</span><select value={settings.sliceAxis} onChange={e=>patchSettings({sliceAxis:e.target.value as 'X'|'Y'|'Z'})}><option>Z</option><option>X</option><option>Y</option></select></label>}
        {wallArt&&<p className="note">Orient the model so the face looks at you in the Model tab (Y up, face toward +Z).</p>}
        <div className="rotation-grid">{(['x','y','z'] as const).map(a=><NumberField key={a} label={`${a.toUpperCase()} rotation`} value={settings.rotationDeg[a]} step={1} suffix="°" onChange={n=>rotate({[a]:n})}/>)}</div>
        {wallArt&&<div className="chips"><button className="chip" onClick={()=>rotate({x:settings.rotationDeg.x-90})}>Z-up → Y-up</button><button className="chip" onClick={()=>rotate({y:(settings.rotationDeg.y+180)%360})}>Turn 180°</button><button className="chip" onClick={()=>rotate({x:0,y:0,z:0})}>Reset</button></div>}
      </>}
    </Section>

    {relief&&<Section id="depth" title="Depth curve" summary={`${settings.relief.source==='depth'?'AI depth':'brightness'} · wall plane ${settings.relief.depthFloor.toFixed(2)} · gamma ${settings.relief.gamma}`} open={isOpen('depth')} toggle={toggle}>
      <div className="segmented"><button className={settings.relief.source==='luminance'?'active':''} onClick={()=>setRelief({source:'luminance'})}>Brightness</button><button className={settings.relief.source==='depth'?'active':''} disabled={reliefBase?.source!=='depth'} onClick={()=>setRelief({source:'depth'})}>AI depth</button></div>
      {reliefBase&&reliefBase.source!==settings.relief.source&&<p className="note">{reliefBase.source==='depth'?'Showing AI depth.':'Brightness is loaded; press Estimate depth to switch to AI depth.'}</p>}
      <label className="toggle"><input type="checkbox" checked={settings.relief.invert} onChange={e=>setRelief({invert:e.target.checked})}/><span>Invert (far becomes near)</span></label>
      <NumberField label="Wall plane (depth floor)" value={settings.relief.depthFloor} min={0} max={.95} step={.01} suffix="" onChange={n=>setRelief({depthFloor:Math.max(0,Math.min(.95,n))})}/>
      <div className="btn-row"><button disabled={!reliefBase} onClick={()=>reliefBase&&setRelief({depthFloor:suggestFloor(reliefBase,mask,{...settings.relief,depthFloor:0})})}>Fit wall plane to subject</button><button disabled={!reliefBase||settings.relief.depthFloor===0} onClick={()=>setRelief({depthFloor:0})}>Reset to 0</button></div>
      <p className="note">The wall plane is where the piece meets the wall. Fit it after the cutout so the back of the subject (ears, hairline) sits at the wall and the nose gets the whole relief depth.</p>
      <NumberField label="Black point" value={settings.relief.blackPoint} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({blackPoint:Math.min(n,settings.relief.whitePoint-.01)})}/>
      <NumberField label="White point" value={settings.relief.whitePoint} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({whitePoint:Math.max(n,settings.relief.blackPoint+.01)})}/>
      <NumberField label="Gamma (below 1 pushes the nose out)" value={settings.relief.gamma} min={.05} max={5} step={.05} suffix="" onChange={n=>setRelief({gamma:n})}/>
      <NumberField label="Blur" value={settings.relief.blurPx} min={0} max={20} step={.1} suffix="px" onChange={n=>setRelief({blurPx:n})}/>
      {!mask&&<NumberField label="Background threshold (no mask)" value={settings.relief.backgroundThreshold} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({backgroundThreshold:n})}/>}
      <NumberField label="Minimum island area" value={settings.relief.minIslandArea} min={0} step={.01} suffix="in²" onChange={n=>setRelief({minIslandArea:n})}/>
    </Section>}

    <Section id="hollow" title="Hollowing" summary={settings.hollowEnabled?`on · wall ${settings.wallThickness} in`:'off'} open={isOpen('hollow')} toggle={toggle}><label className="toggle"><input type="checkbox" checked={settings.hollowEnabled} onChange={e=>patchSettings({hollowEnabled:e.target.checked})}/><span>Hollow layers (keep only what shows)</span></label><NumberField label="Wall thickness" value={settings.wallThickness} min={.05} onChange={n=>patchSettings({wallThickness:n})}/><NumberField label="Overlap margin" value={settings.overlapMargin} min={0} onChange={n=>patchSettings({overlapMargin:n})}/><NumberField label={mode==='terraced'?'Back solid caps (wall side)':'Bottom solid caps'} value={settings.bottomSolidCaps} min={0} step={1} suffix="" onChange={n=>patchSettings({bottomSolidCaps:Math.round(n)})}/><NumberField label={mode==='terraced'?'Front solid caps':'Top solid caps'} value={settings.topSolidCaps} min={0} step={1} suffix="" onChange={n=>patchSettings({topSolidCaps:Math.round(n)})}/></Section>

    <Section id="pins" title={mode==='slabs'?'Rods & marks':'Registration & marks'} summary={mode==='slabs'?`rod hole ${settings.wallArt.rodHoleDiameter} in · text ${settings.textHeight} in`:`dowel ${settings.dowelDiameter} in · text ${settings.textHeight} in`} open={isOpen('pins')} toggle={toggle}>
      {mode!=='slabs'&&<><NumberField label={wallArt?'Pin diameter':'Dowel diameter'} value={settings.dowelDiameter} min={.05} onChange={n=>patchSettings({dowelDiameter:n})}/><NumberField label="Boss diameter" value={settings.dowelBossDiameter} min={settings.dowelDiameter} onChange={n=>patchSettings({dowelBossDiameter:n})}/></>}
      <NumberField label="Edge clearance" value={settings.dowelEdgeClearance} min={0} onChange={n=>patchSettings({dowelEdgeClearance:n})}/>
      <NumberField label="Text height" value={settings.textHeight} min={.1} onChange={n=>patchSettings({textHeight:n})}/>
      {wallArt&&<p className="note">Numbers only go where the next piece covers them. A piece with no hidden spot is left blank and listed in warnings.</p>}
    </Section>

    <Section id="sheets" title="Sheets" summary={`${settings.sheetWidth} × ${settings.sheetHeight} in · gap ${settings.partGap} in`} open={isOpen('sheets')} toggle={toggle}>
      <div className="chips">{SHEET_PRESETS.map(p=><button key={p.label} className={near(settings.sheetWidth,p.width)&&near(settings.sheetHeight,p.height)?'chip active':'chip'} onClick={()=>patchSettings({sheetWidth:p.width,sheetHeight:p.height})}>{p.label}</button>)}</div>
      <NumberField label="Sheet width" value={settings.sheetWidth} min={1} onChange={n=>patchSettings({sheetWidth:n})}/><NumberField label="Sheet height" value={settings.sheetHeight} min={1} onChange={n=>patchSettings({sheetHeight:n})}/><NumberField label="Edge margin" value={settings.sheetEdgeMargin} min={0} onChange={n=>patchSettings({sheetEdgeMargin:n})}/><NumberField label="Part gap" value={settings.partGap} min={0} onChange={n=>patchSettings({partGap:n})}/><label className="toggle"><input type="checkbox" checked={settings.nestInCutouts} onChange={e=>patchSettings({nestInCutouts:e.target.checked})}/><span>Nest inside ring cutouts</span></label></Section>

    {settings.inputMode==='ai'&&<Section id="ai" title="AI settings" summary={settings.ai.apiKeyPresent?'key saved':'no key'} open={isOpen('ai')} toggle={toggle}><label className="field"><span>Meshy API key</span><input type="password" value={apiKey} placeholder="Stored only in this browser" onChange={e=>setApiKey(e.target.value)}/></label><label className="field"><span>Proxy URL (optional)</span><input value={settings.ai.proxyUrl} placeholder="https://worker.example.workers.dev" onChange={e=>setAi({proxyUrl:e.target.value})}/></label><label className="field"><span>Mesh type</span><select value={settings.ai.modelType} onChange={e=>setAi({modelType:e.target.value as 'standard'|'lowpoly'})}><option value="standard">Standard</option><option value="lowpoly">Low poly</option></select></label><NumberField label="Target polygons" value={settings.ai.targetPolycount} min={1000} step={1000} suffix="" onChange={n=>setAi({targetPolycount:Math.round(n)})}/></Section>}

    <div className="generate-bar">
      <div className={count>LAYER_SOFT_LIMIT?'generate-summary alert':'generate-summary'}>
        <b>{count} {mode==='slabs'?'slabs':'layers'}</b>
        <span>{mode==='terraced'?`${(relief?settings.relief.depth:keptDepth).toFixed(2)} in deep`:mode==='slabs'?`${(count*pitch-Math.max(0,settings.wallArt.slabGap)).toFixed(1)} in ${settings.wallArt.slabDirection==='horizontal'?'tall':'wide'}`:`${(count*t).toFixed(2)} in tall`}</span>
        <span>{t} in stock{mode==='slabs'&&settings.wallArt.slabGap>0?` · ${settings.wallArt.slabGap} in gaps`:''}</span>
      </div>
      <button className="generate" onClick={generate}>Generate slices & sheets</button>
    </div>
  </aside>;
}
