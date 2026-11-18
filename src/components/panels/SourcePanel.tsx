import { useState } from 'react';
import { useStore } from '../../store';
import { useActions } from '../../actions';
import { suggestFloor } from '../../relief/heightmap';
import { effectiveMode } from '../../plan/plan';
import { useDesign } from '../../design/DesignContext';
import { useJudgement } from '../../design/useJudgement';
import { FAIR, GOOD, VERDICT_LABEL } from '../../design/score';
import { IdeaBlock } from '../DesignStage';
import { NumberField } from '../NumberField';
import { Disclosure, Row, Segmented, useNarrow } from '../ui';

function Check() {
  return <svg className="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.6 11.5 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

/** Verdict and meters for the picture in use, so the bench view carries the same judgement as its tile. */
function CarveCard() {
  const { pictures, activeId, setView, select } = useDesign();
  const picture = pictures.find(p => p.id === activeId) ?? null;
  const judgement = useJudgement(picture);
  if (!picture || !judgement) return null;
  const { scores } = judgement;
  const level = (v: number) => v >= GOOD ? 'good' : v >= FAIR ? 'fair' : 'poor';
  return <button type="button" className="carve-card" onClick={() => { select(picture.id); setView('pictures'); }} title="See how this picture carves">
    <span className={`verdict ${scores.verdict}`}>{VERDICT_LABEL[scores.verdict]}</span>
    <span className={`carve-score ${level(scores.detail)}`}>Detail kept <b>{scores.detail}</b></span>
    <span className={`carve-score ${level(scores.sturdy)}`}>Sturdy <b>{scores.sturdy}</b></span>
  </button>;
}

function PhotoSource() {
  const { settings, sourceAsset, reliefBase, mask, dispatch } = useStore();
  const { runDepth, runCutout, thresholdMask, clearMask, pickPhoto } = useActions();
  const design = useDesign();
  const narrow = useNarrow();
  const r = settings.relief;
  const setRelief = (value: Partial<typeof r>) => dispatch({ type: 'relief', value });
  const loaded = !!reliefBase;
  const depthDone = reliefBase?.source === 'depth';
  const waiting = design.waiting.length;
  const active = design.pictures.find(p => p.id === design.activeId) ?? null;

  return <div className="step-panel">
    {!narrow && <section className="group">
      <h2>What should it be?</h2>
      <IdeaBlock/>
    </section>}

    <section className="group">
      <div className="group-head"><h2>Pictures</h2>{design.pictures.length > 0 && <span className="count">{design.pictures.length} in the tray</span>}</div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => { void design.paste(); }}>Paste</button>
        <button type="button" className="btn" onClick={pickPhoto}>Choose photos</button>
      </div>
      <p className="hint">{waiting > 0
        ? `${waiting} waiting to be judged. Judging estimates depth on this device and shows each one as cut.`
        : 'Paste, drop or choose. A sheet of several designs comes apart into one picture each.'}</p>
      {design.pictures.length > (active ? 1 : 0) && <button type="button" className="link" onClick={design.removeOthers}>{active ? 'Remove all but the one in use' : 'Remove all'}</button>}
    </section>

    {loaded && <section className="group">
      <h2>The picture in use</h2>
      <p className="in-use">{active?.name ?? (sourceAsset?.kind === 'image' ? sourceAsset.name : 'Photo')}</p>
      <CarveCard/>
      <ol className="todo">
        <li className={depthDone ? 'done' : ''}>
          <div><b>{depthDone && <Check/>}Depth</b><small>{depthDone ? 'Estimated from the picture' : 'Brightness is standing in for depth'}</small></div>
          <button type="button" className={depthDone ? 'btn' : 'btn strong'} onClick={runDepth}>{depthDone ? 'Redo' : 'Estimate depth'}</button>
        </li>
        <li className={mask ? 'done' : ''}>
          <div><b>{mask && <Check/>}Cutout</b><small>{mask ? (active?.maskFrom === 'plain' ? 'Plain background cut away' : active?.maskFrom === 'transparent' ? 'Taken from the transparent background' : 'Background removed') : 'The whole picture is the piece'}</small></div>
          <button type="button" className={mask ? 'btn' : 'btn strong'} onClick={runCutout}>{mask ? 'Redo' : 'Cut out subject'}</button>
        </li>
      </ol>
      <p className="hint">Under Fine-tune, paint on the picture to fix the cutout. Red areas are left out of the piece.</p>
    </section>}

    {loaded && <Disclosure title="Cut out by hand" summary={mask ? 'cutout in place' : 'no cutout'}>
      <p className="hint">Start from brightness, then paint the rest on the picture.</p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => { thresholdMask(); design.setView('tune'); }}>Start from brightness</button>
        <button type="button" className="btn" disabled={!mask} onClick={clearMask}>Clear the cutout</button>
      </div>
    </Disclosure>}

    {loaded && <Disclosure title="Fine-tune the depth" summary={`${r.source === 'depth' ? 'AI depth' : 'brightness'}, wall plane ${r.depthFloor.toFixed(2)}`}>
      <Row label="Depth from">
        <Segmented label="Depth from" value={r.source} onChange={v => setRelief({ source: v })}
          options={[{ value: 'luminance', label: 'Brightness' }, { value: 'depth', label: 'AI depth', disabled: reliefBase?.source !== 'depth', title: reliefBase?.source !== 'depth' ? 'Estimate depth first' : undefined }]}/>
      </Row>
      <label className="toggle"><input type="checkbox" checked={r.invert} onChange={e => setRelief({ invert: e.target.checked })}/><span>Invert, so far becomes near</span></label>
      <NumberField label="Wall plane" hint="where the piece meets the wall" value={r.depthFloor} min={0} max={0.95} step={0.01} suffix="" onChange={n => setRelief({ depthFloor: Math.max(0, Math.min(0.95, n)) })}/>
      <div className="btn-row">
        <button type="button" className="btn" disabled={!reliefBase} onClick={() => reliefBase && setRelief({ depthFloor: suggestFloor(reliefBase, mask, { ...r, depthFloor: 0 }) })}>Fit to the subject</button>
        <button type="button" className="btn" disabled={!reliefBase || r.depthFloor === 0} onClick={() => setRelief({ depthFloor: 0 })}>Reset</button>
      </div>
      <p className="hint">Fit it after the cutout, so the back of the subject sits at the wall and the nose gets the full depth.</p>
      <NumberField label="Black point" value={r.blackPoint} min={0} max={1} step={0.01} suffix="" onChange={n => setRelief({ blackPoint: Math.min(n, r.whitePoint - 0.01) })}/>
      <NumberField label="White point" value={r.whitePoint} min={0} max={1} step={0.01} suffix="" onChange={n => setRelief({ whitePoint: Math.max(n, r.blackPoint + 0.01) })}/>
      <NumberField label="Gamma" hint="below 1 pushes the nose out" value={r.gamma} min={0.05} max={5} step={0.05} suffix="" onChange={n => setRelief({ gamma: n })}/>
      <NumberField label="Smoothing" value={r.blurPx} min={0} max={20} step={0.1} suffix="px" onChange={n => setRelief({ blurPx: n })}/>
      {!mask && <NumberField label="Background below" hint="used when there is no cutout" value={r.backgroundThreshold} min={0} max={1} step={0.01} suffix="" onChange={n => setRelief({ backgroundThreshold: n })}/>}
      <NumberField label="Drop specks under" value={r.minIslandArea} min={0} step={0.01} suffix="in²" onChange={n => setRelief({ minIslandArea: n })}/>
    </Disclosure>}

    <Disclosure title="About the AI tools">
      <p className="hint">ChatGPT draws the pictures in its own app, on your plan; StackCarve only writes the prompt and reads what you paste back. Depth and cutout run on this device and nothing is uploaded. Their models download once, roughly 50 to 150 MB in total. Cutout tries RMBG-1.4 first (licensed for non-commercial use), then BiRefNet (MIT), then MODNet.</p>
    </Disclosure>
  </div>;
}

function ModelSource() {
  const { settings, patchSettings, mesh, sourceAsset } = useStore();
  const { loadSample, generateWithMeshy } = useActions();
  const mode = effectiveMode(settings);
  const wallArt = mode !== 'statue';
  const rot = settings.rotationDeg;
  const rotate = (patch: Partial<typeof rot>) => patchSettings({ rotationDeg: { ...rot, ...patch } });
  const setWall = (patch: Partial<typeof settings.wallArt>) => patchSettings({ wallArt: { ...settings.wallArt, ...patch } });
  const setAi = (patch: Partial<typeof settings.ai>) => patchSettings({ ai: { ...settings.ai, ...patch } });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('stackcarve.meshy.apiKey') ?? '');
  const [aiImage, setAiImage] = useState<File | null>(null);

  return <div className="step-panel">
    <section className="group">
      <h2>Your 3D model</h2>
      <label className="drop" htmlFor="mesh-file">
        <b>{mesh ? 'Replace the model' : 'Choose a 3D model'}</b>
        <span>{mesh?.sourceName ?? 'STL, OBJ or GLB'}</span>
      </label>
      {!mesh && <button type="button" className="link" onClick={loadSample}>No model handy? Try the sample head</button>}
    </section>

    {mesh && <section className="group">
      <h2>Which way is up?</h2>
      <p className="hint">{wallArt ? 'Turn the model until the face looks at you with the top up. The orange arrow points up.' : 'Stand the model the way it will be stacked. Drag the rings, or use the buttons.'}</p>
      <div className="chips">
        <button type="button" className="chip" onClick={() => rotate({ x: rot.x - 90 })}>Stand it up</button>
        <button type="button" className="chip" onClick={() => rotate({ y: (rot.y + 180) % 360 })}>Turn it around</button>
        <button type="button" className="chip" onClick={() => rotate({ x: 0, y: 0, z: 0 })}>Reset</button>
      </div>
      {!wallArt && <Row label="Layers stack along">
        <select aria-label="Layers stack along" value={settings.sliceAxis} onChange={e => patchSettings({ sliceAxis: e.target.value as 'X' | 'Y' | 'Z' })}><option>Z</option><option>X</option><option>Y</option></select>
      </Row>}
    </section>}

    {mesh && <Disclosure title="Exact angles" summary={`${rot.x}°, ${rot.y}°, ${rot.z}°`}>
      {(['x', 'y', 'z'] as const).map(a => <NumberField key={a} label={`Turn about ${a.toUpperCase()}`} value={rot[a]} step={1} suffix="°" onChange={n => rotate({ [a]: n })}/>)}
    </Disclosure>}

    {wallArt && <Disclosure title="Depth and backing" summary={`depth × ${settings.wallArt.depthScale}`}>
      <NumberField label="Flatten the depth" hint="1 keeps it true, 0.5 halves it" value={settings.wallArt.depthScale} min={0.1} max={1} step={0.05} suffix="×" onChange={n => setWall({ depthScale: Math.min(1, Math.max(0.1, n)) })}/>
      {mode === 'terraced' && <label className="toggle"><input type="checkbox" checked={settings.wallArt.basePlate} onChange={e => setWall({ basePlate: e.target.checked })}/><span>Back layer is the full outline, so it hangs as one plaque</span></label>}
    </Disclosure>}

    <Disclosure title="Make a model from a photo" summary="needs a Meshy key">
      <p className="hint">Meshy turns one photo of a statue into a 3D model. It is a paid service; your key stays in this browser.</p>
      <label className="drop small">
        <input type="file" hidden accept="image/png,image/jpeg" onChange={e => setAiImage(e.target.files?.[0] ?? null)}/>
        <b>Choose a photo of the statue</b>
        <span>{aiImage?.name ?? (sourceAsset?.kind === 'image' ? sourceAsset.name : 'PNG or JPEG')}</span>
      </label>
      <Row label="Meshy API key"><input type="password" aria-label="Meshy API key" value={apiKey} placeholder="Kept in this browser" onChange={e => setApiKey(e.target.value)}/></Row>
      <Row label="Proxy address" hint="optional"><input aria-label="Proxy address" value={settings.ai.proxyUrl} placeholder="https://…" onChange={e => setAi({ proxyUrl: e.target.value })}/></Row>
      <NumberField label="Target triangles" value={settings.ai.targetPolycount} min={1000} step={1000} suffix="" onChange={n => setAi({ targetPolycount: Math.round(n) })}/>
      <button type="button" className="btn strong wide" onClick={() => generateWithMeshy(aiImage, apiKey)}>Make the model</button>
    </Disclosure>
  </div>;
}

export function SourcePanel() {
  const { settings } = useStore();
  return settings.inputMode === 'relief' ? <PhotoSource/> : <ModelSource/>;
}
