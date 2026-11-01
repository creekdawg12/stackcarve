import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { NumberField } from './NumberField';
import { loadMeshFile, loadMeshFromArrayBuffer } from '../mesh/loadMesh';
import { buildHeightmap } from '../relief/heightmap';
import { fileToDataUrl, dataUrlToFile, downloadBlob } from '../utils/files';
import { runPipeline } from '../engine/pipeline';
import { MeshyProvider } from '../providers/meshy';
import { makeProject, parseProject } from '../export/project';
import { MODE_PRESETS, SHEET_PRESETS, THICKNESS_PRESETS } from '../defaults';
import { measureOriented } from '../mesh/measure';
import type { BuildMode } from '../types';

const MODE_LABEL: Record<BuildMode, string> = { statue: 'Statue', terraced: 'Wall art: terraced', slabs: 'Wall art: slabs' };
const MODE_NOTE: Record<BuildMode, string> = {
  statue: 'Free-standing stack. Slices run across the chosen axis and every layer gets two dowels.',
  terraced: 'Layers lie parallel to the wall like a topo map. Short pins between neighbours, hidden where the next layer covers them.',
  slabs: 'Horizontal slabs stacked bottom to top with a flat back. Two rods run through a hidden strip along the back edge.'
};

export function ControlPanel({ projectName, setProjectName }: { projectName: string; setProjectName: (s:string)=>void }) {
  const store = useStore();
  const { settings, patchSettings, sourceAsset, mesh, heightmap, result, dispatch } = store;
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('stackcarve.meshy.apiKey') ?? '');
  const [aiImage, setAiImage] = useState<File | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const setRelief = (patch: Partial<typeof settings.relief>) => patchSettings({ relief: { ...settings.relief, ...patch } });
  const setAi = (patch: Partial<typeof settings.ai>) => patchSettings({ ai: { ...settings.ai, ...patch } });
  const setWall = (patch: Partial<typeof settings.wallArt>) => patchSettings({ wallArt: { ...settings.wallArt, ...patch } });
  const setMode = (buildMode: BuildMode) => patchSettings({ buildMode, ...MODE_PRESETS[buildMode] });
  const rotate = (patch: Partial<typeof settings.rotationDeg>) => patchSettings({ rotationDeg: { ...settings.rotationDeg, ...patch } });

  const relief = settings.inputMode === 'relief';
  const mode: BuildMode = relief ? 'terraced' : settings.buildMode;
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
  const count = Math.max(1, Math.round((mode === 'terraced' && !relief ? keptDepth : settings.targetHeight) / t));

  const loadMesh = async (file: File) => {
    dispatch({type:'busy',label:'Loading mesh',progress:15,status:'Welding vertices and checking topology…'});
    try {
      const loaded = await loadMeshFile(file);
      dispatch({type:'mesh',mesh:loaded});
      dispatch({type:'source',asset:{kind:'mesh',name:file.name,mimeType:file.type||'application/octet-stream',dataUrl:await fileToDataUrl(file),sizeBytes:file.size},mesh:loaded});
      dispatch({type:'busy',label:null,progress:100,status:`Loaded ${file.name}.`});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const loadPhoto = async (file: File) => {
    dispatch({type:'busy',label:'Processing photo',progress:20,status:'Building luminance heightmap…'});
    try {
      const map = await buildHeightmap(file, settings.relief);
      dispatch({type:'heightmap',heightmap:map});
      dispatch({type:'source',asset:{kind:'image',name:file.name,mimeType:file.type,dataUrl:await fileToDataUrl(file),sizeBytes:file.size}});
      dispatch({type:'busy',label:null,progress:100,status:`Loaded ${file.name}.`});
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  const generate = async () => {
    dispatch({type:'busy',label:'Generating cut geometry',progress:10,status:'Sectioning and rebuilding contours…'});
    try {
      let map = heightmap;
      if (relief && sourceAsset?.dataUrl) {
        const f = dataUrlToFile(sourceAsset.dataUrl, sourceAsset.name);
        map = await buildHeightmap(f, settings.relief);
        dispatch({type:'heightmap',heightmap:map});
      }
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

  const saveProject = () => downloadBlob(new Blob([JSON.stringify(makeProject(projectName,settings,sourceAsset,result),null,2)],{type:'application/json'}),`${projectName||'stackcarve'}.stackcarve.json`);
  const loadProject = async (file: File) => {
    try {
      const project=parseProject(await file.text()); setProjectName(project.name); dispatch({type:'project',project});
      if(project.sourceAsset?.dataUrl){const f=dataUrlToFile(project.sourceAsset.dataUrl,project.sourceAsset.name);if(project.sourceAsset.kind==='mesh')await loadMesh(f);else await loadPhoto(f);}
    } catch(e) { dispatch({type:'busy',label:null,status:e instanceof Error?e.message:String(e)}); }
  };

  return <aside className="controls">
    <div className="project-row"><input className="project-name" value={projectName} onChange={e=>setProjectName(e.target.value)} aria-label="Project name"/><button onClick={saveProject}>Save</button><button onClick={()=>projectInput.current?.click()}>Load</button><input ref={projectInput} hidden type="file" accept=".json" onChange={e=>e.target.files?.[0]&&loadProject(e.target.files[0])}/></div>

    <section><h3>Input</h3><div className="segmented">{(['mesh','relief','ai'] as const).map(m=><button className={settings.inputMode===m?'active':''} key={m} onClick={()=>patchSettings({inputMode:m})}>{m==='mesh'?'Mesh':m==='relief'?'Photo relief':'AI statue'}</button>)}</div>
      {settings.inputMode==='mesh'&&<label className="drop"><input type="file" accept=".stl,.obj,.glb" onChange={e=>e.target.files?.[0]&&loadMesh(e.target.files[0])}/><b>Load STL, OBJ, or GLB</b><span>{mesh?.sourceName??'No mesh loaded'}</span></label>}
      {relief&&<><label className="drop"><input type="file" accept="image/png,image/jpeg" onChange={e=>e.target.files?.[0]&&loadPhoto(e.target.files[0])}/><b>Load relief photo</b><span>{sourceAsset?.kind==='image'?sourceAsset.name:'No image loaded'}</span></label>{heightmap&&<img className="heightmap-preview" src={heightmap.previewUrl} alt="Processed heightmap"/>}</>}
      {settings.inputMode==='ai'&&<><label className="drop"><input type="file" accept="image/png,image/jpeg" onChange={e=>{const f=e.target.files?.[0];if(f){setAiImage(f);loadPhoto(f)}}}/><b>Load statue photo</b><span>{aiImage?.name??(sourceAsset?.kind==='image'?sourceAsset.name:'No image loaded')}</span></label><button className="primary full" onClick={generateAi}>Generate GLB with Meshy</button></>}
    </section>

    <section><h3>Build</h3>
      {relief
        ? <p className="note">Photo relief always builds as terraced wall art: the photo's brightness becomes depth, layer 1 sits against the wall.</p>
        : <>
          <div className="segmented vertical">{(['statue','terraced','slabs'] as const).map(m=><button className={settings.buildMode===m?'active':''} key={m} onClick={()=>setMode(m)}>{MODE_LABEL[m]}</button>)}</div>
          <p className="note">{MODE_NOTE[settings.buildMode]}</p>
        </>}
    </section>

    <section><h3>Scale & layers</h3>
      <NumberField label={relief?'Relief depth':wallArt?'Finished height on wall':'Target height'} value={settings.targetHeight} min={.1} onChange={n=>patchSettings({targetHeight:n})}/>
      {wallArt&&!relief&&<>
        {scaled&&<div className="computed"><span>Model at this height</span><b>{scaled.width.toFixed(1)} wide × {scaled.depth.toFixed(1)} deep</b></div>}
        <NumberField label="Relief depth kept from the front (0 = all)" value={settings.wallArt.reliefDepth} min={0} onChange={n=>setWall({reliefDepth:n})}/>
        <NumberField label="Depth compression" value={settings.wallArt.depthScale} min={.1} max={1} step={.05} suffix="×" onChange={n=>setWall({depthScale:Math.min(1,Math.max(.1,n))})}/>
        {scaled&&<p className="note">The wall plane sits {keptDepth.toFixed(1)} in behind the nose; anything deeper is cut away. A face usually wants the front 40 to 60% of the head.</p>}
      </>}
      <NumberField label="Material thickness (measure it)" value={t} min={.05} step={.001} onChange={n=>patchSettings({materialThickness:n})}/>
      <div className="chips">{THICKNESS_PRESETS.map(p=><button key={p.label} className={near(t,p.value)?'chip active':'chip'} onClick={()=>patchSettings({materialThickness:p.value})}>{p.label}</button>)}</div>
      <div className="computed"><span>{mode==='slabs'?'Slab count (before trimming)':'Layer count'}</span><b>{count}</b></div>
      <div className="computed"><span>{mode==='terraced'?'Achieved depth':'Achieved height'}</span><b>{(count*t).toFixed(3)} in</b></div>
      {mode==='terraced'&&!relief&&<label className="toggle"><input type="checkbox" checked={settings.wallArt.basePlate} onChange={e=>setWall({basePlate:e.target.checked})}/><span>Base plate: back layer becomes the full silhouette</span></label>}
      {mode==='slabs'&&<>
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
    </section>

    {relief&&<section><h3>Heightmap</h3><label className="toggle"><input type="checkbox" checked={settings.relief.invert} onChange={e=>setRelief({invert:e.target.checked})}/><span>Invert luminance</span></label><NumberField label="Finished width" value={settings.relief.finishedWidth} min={1} onChange={n=>setRelief({finishedWidth:n})}/><NumberField label="Black point" value={settings.relief.blackPoint} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({blackPoint:Math.min(n,settings.relief.whitePoint-.01)})}/><NumberField label="White point" value={settings.relief.whitePoint} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({whitePoint:Math.max(n,settings.relief.blackPoint+.01)})}/><NumberField label="Gamma" value={settings.relief.gamma} min={.05} max={5} step={.05} suffix="" onChange={n=>setRelief({gamma:n})}/><NumberField label="Blur" value={settings.relief.blurPx} min={0} max={20} step={.1} suffix="px" onChange={n=>setRelief({blurPx:n})}/><NumberField label="Background threshold" value={settings.relief.backgroundThreshold} min={0} max={1} step={.01} suffix="" onChange={n=>setRelief({backgroundThreshold:n})}/><NumberField label="Minimum island area" value={settings.relief.minIslandArea} min={0} step={.01} suffix="in²" onChange={n=>setRelief({minIslandArea:n})}/><label className="toggle disabled"><input type="checkbox" disabled checked={settings.relief.useDepthModel}/><span>Depth Anything Small (adapter reserved)</span></label></section>}

    <section><h3>Hollowing</h3><label className="toggle"><input type="checkbox" checked={settings.hollowEnabled} onChange={e=>patchSettings({hollowEnabled:e.target.checked})}/><span>Hollow layers (keep only what shows)</span></label><NumberField label="Wall thickness" value={settings.wallThickness} min={.05} onChange={n=>patchSettings({wallThickness:n})}/><NumberField label="Overlap margin" value={settings.overlapMargin} min={0} onChange={n=>patchSettings({overlapMargin:n})}/><NumberField label={mode==='terraced'?'Back solid caps (wall side)':'Bottom solid caps'} value={settings.bottomSolidCaps} min={0} step={1} suffix="" onChange={n=>patchSettings({bottomSolidCaps:Math.round(n)})}/><NumberField label={mode==='terraced'?'Front solid caps':'Top solid caps'} value={settings.topSolidCaps} min={0} step={1} suffix="" onChange={n=>patchSettings({topSolidCaps:Math.round(n)})}/></section>

    <section><h3>{mode==='slabs'?'Rods & marks':'Registration & marks'}</h3>
      {mode!=='slabs'&&<><NumberField label={wallArt?'Pin diameter':'Dowel diameter'} value={settings.dowelDiameter} min={.05} onChange={n=>patchSettings({dowelDiameter:n})}/><NumberField label="Boss diameter" value={settings.dowelBossDiameter} min={settings.dowelDiameter} onChange={n=>patchSettings({dowelBossDiameter:n})}/></>}
      <NumberField label="Edge clearance" value={settings.dowelEdgeClearance} min={0} onChange={n=>patchSettings({dowelEdgeClearance:n})}/>
      <NumberField label="Text height" value={settings.textHeight} min={.1} onChange={n=>patchSettings({textHeight:n})}/>
      {wallArt&&<p className="note">Numbers only go where the next piece covers them. A piece with no hidden spot is left blank and listed in warnings.</p>}
    </section>

    <section><h3>Sheets</h3>
      <div className="chips">{SHEET_PRESETS.map(p=><button key={p.label} className={near(settings.sheetWidth,p.width)&&near(settings.sheetHeight,p.height)?'chip active':'chip'} onClick={()=>patchSettings({sheetWidth:p.width,sheetHeight:p.height})}>{p.label}</button>)}</div>
      <NumberField label="Sheet width" value={settings.sheetWidth} min={1} onChange={n=>patchSettings({sheetWidth:n})}/><NumberField label="Sheet height" value={settings.sheetHeight} min={1} onChange={n=>patchSettings({sheetHeight:n})}/><NumberField label="Edge margin" value={settings.sheetEdgeMargin} min={0} onChange={n=>patchSettings({sheetEdgeMargin:n})}/><NumberField label="Part gap" value={settings.partGap} min={0} onChange={n=>patchSettings({partGap:n})}/><label className="toggle"><input type="checkbox" checked={settings.nestInCutouts} onChange={e=>patchSettings({nestInCutouts:e.target.checked})}/><span>Nest inside ring cutouts</span></label></section>

    {settings.inputMode==='ai'&&<section><h3>AI settings</h3><label className="field"><span>Meshy API key</span><input type="password" value={apiKey} placeholder="Stored only in this browser" onChange={e=>setApiKey(e.target.value)}/></label><label className="field"><span>Proxy URL (optional)</span><input value={settings.ai.proxyUrl} placeholder="https://worker.example.workers.dev" onChange={e=>setAi({proxyUrl:e.target.value})}/></label><label className="field"><span>Mesh type</span><select value={settings.ai.modelType} onChange={e=>setAi({modelType:e.target.value as 'standard'|'lowpoly'})}><option value="standard">Standard</option><option value="lowpoly">Low poly</option></select></label><NumberField label="Target polygons" value={settings.ai.targetPolycount} min={1000} step={1000} suffix="" onChange={n=>setAi({targetPolycount:Math.round(n)})}/></section>}

    <button className="generate" onClick={generate}>Generate slices & sheets</button>
  </aside>;
}
