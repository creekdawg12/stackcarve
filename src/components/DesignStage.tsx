import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { useDesign } from '../design/DesignContext';
import { useCutPreview, useJudgement, photoBrief } from '../design/useJudgement';
import { judgePicture } from '../design/judge';
import { GOOD, FAIR, VERDICT_LABEL, type Scores, type SuggestionId } from '../design/score';
import { buildFollowUp, claudeLink } from '../design/prompt';
import type { Picture } from '../design/types';
import { effectiveMode } from '../plan/plan';
import { renderAnglePreview, renderFrontPreview, type FrontPreview } from '../plan/preview';
import { num, piecesText, rangeText, weightText } from '../plan/format';
import { copyImage, copyText } from '../utils/clipboard';
import { downloadBlob } from '../utils/files';
import { useNextAction } from './nextAction';
import { PhotoWorkbench } from './PhotoWorkbench';
import { PreviewCanvas } from './PreviewCanvas';
import { Disclosure, Row, Segmented, useNarrow } from './ui';

/** The idea and the hand-off to ChatGPT. Lives in the side panel, or at the top of the stage on a phone. */
export function IdeaBlock() {
  const d = useDesign();
  const id = useId();
  const ready = d.idea.trim().length > 0;
  return <>
    <textarea id={id} className="idea" rows={3} value={d.idea} onChange={e => d.setIdea(e.target.value)}
      placeholder="English bulldog face, grumpy, big jowls" aria-label="What should it be?"/>
    {ready
      // A real link, so the browser opens it as a tap on a link and never as a blocked pop-up.
      ? <a className="btn strong wide" href={d.link} target="_blank" rel="noopener" onClick={d.handOff}>Open ChatGPT with the prompt</a>
      : <button type="button" className="btn strong wide" onClick={() => d.say('Describe what to make first, then the prompt can be written.')}>Open ChatGPT with the prompt</button>}
    <p className="hint">{d.sent
      ? 'Prompt handed over. Copy the picture ChatGPT makes, then paste it here.'
      : 'ChatGPT draws it on your own plan. Copy the picture it makes, come back and paste it.'}</p>
    <Disclosure title="The prompt" summary={d.templateEdited ? 'edited' : d.takes === 'four' ? 'four takes on one sheet' : 'one design'}>
      <Row label="Ask for">
        <Segmented label="Ask for" value={d.takes} onChange={d.setTakes} options={[{ value: 'four', label: 'Four takes' }, { value: 'one', label: 'One design' }]}/>
      </Row>
      <textarea className="prompt-text" aria-label="Prompt text" rows={11} value={d.template} onChange={e => d.setTemplate(e.target.value)} spellCheck={false}/>
      <p className="hint">Your idea goes in wherever it says {'{idea}'}. Edit the rest to taste.</p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={d.copyPrompt}>Copy the prompt</button>
        <button type="button" className="btn" disabled={!d.templateEdited} onClick={() => d.setTemplate(null)}>Reset</button>
      </div>
    </Disclosure>
  </>;
}

function Meter({ label, value, note }: { label: string; value: number; note?: string }) {
  const level = value >= GOOD ? 'good' : value >= FAIR ? 'fair' : 'poor';
  return <div className={`meter ${level}`}>
    <div className="meter-head"><span>{label}</span><b>{value}</b></div>
    <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${Math.max(3, value)}%` }}/></div>
    {note && <small>{note}</small>}
  </div>;
}

/**
 * Bring the selected picture's details into view from their top: beside the tiles on a wide
 * screen, below them on a narrow one, clear of the bar that stays pinned above.
 */
function showInspector() {
  const el = document.querySelector<HTMLElement>('.inspector');
  if (!el) return;
  const bar = document.querySelector<HTMLElement>('.design-bar');
  el.style.scrollMarginTop = `${(bar?.offsetHeight ?? 60) + 10}px`;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function Tile({ picture, index }: { picture: Picture; index: number }) {
  const d = useDesign();
  const judgement = useJudgement(picture);
  const preview = useCutPreview(judgement, 360, d.angled);
  const selected = d.selectedId === picture.id;
  const state = picture.state === 'judging' ? 'Judging' : picture.state === 'failed' ? 'Could not judge' : 'Not judged yet';
  const pick = () => {
    d.select(picture.id);
    setTimeout(showInspector, 60);
  };
  return <button type="button" className={selected ? 'tile selected' : 'tile'} aria-pressed={selected} onClick={pick}>
    <span className="tile-wall">
      {preview ? <PreviewCanvas preview={preview} label={`${picture.name}, as cut`}/> : <img src={picture.dataUrl} alt={picture.name}/>}
      <span className="tile-no" aria-hidden="true">{index + 1}</span>
      {d.activeId === picture.id && <span className="tile-flag">In use</span>}
    </span>
    <span className="tile-name">{picture.name}</span>
    {judgement
      ? <span className={`verdict ${judgement.scores.verdict}`}>{VERDICT_LABEL[judgement.scores.verdict]}</span>
      : <span className="tile-state">{state}</span>}
    {judgement && <span className="tile-scores"><span>Detail <b>{judgement.scores.detail}</b></span><span>Sturdy <b>{judgement.scores.sturdy}</b></span></span>}
  </button>;
}

/** Width of an element as it is laid out, kept current as the window changes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * A CSS pixel is defined by the angle it covers at a normal viewing distance (about 0.0213
 * degrees), so the on-screen size that matches standing a given distance from the piece can be
 * worked out. It is an approximation: nobody holds a tablet at exactly the reference distance.
 */
const DEGREES_PER_PX = 0.0213;
const pixelsFor = (inches: number, feet: number) => (2 * Math.atan(inches / 2 / (feet * 12)) * 180 / Math.PI) / DEGREES_PER_PX;
const feetFor = (inches: number, px: number) => inches / 2 / Math.tan((px * DEGREES_PER_PX / 2) * Math.PI / 180) / 12;

const DISTANCES = [10, 20, 40] as const;

function WallView({ picture, preview, slabs }: { picture: Picture; preview: FrontPreview | null; slabs: boolean }) {
  const d = useDesign();
  const [feet, setFeet] = useState<number>(10);
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!preview) {
    return <div className="wall-view" ref={ref}><div className="wall"><img src={picture.dataUrl} alt={picture.name}/></div></div>;
  }
  const wanted = pixelsFor(preview.heightIn, feet);
  // Never taller than the space allows, never wider than the wall it is drawn on.
  const room = Math.max(60, width - 28);
  const shown = Math.max(40, Math.min(wanted, 380, room * preview.height / preview.width));
  const actual = feetFor(preview.heightIn, shown);
  const clipped = shown < wanted - 1;
  return <div className="wall-view" ref={ref}>
    <div className="wall">
      <PreviewCanvas preview={preview} label={`${picture.name} as it would be cut`} style={{ height: `${Math.round(shown)}px`, width: 'auto' }}/>
    </div>
    <div className="wall-foot">
      <div className="wall-switches">
        <Segmented label="Seen from" value={String(feet)} onChange={v => setFeet(Number(v))} options={DISTANCES.map(f => ({ value: String(f), label: `${f} ft` }))}/>
        {slabs && <Segmented label="Slabs shown" value={d.angled ? 'angled' : 'front'} onChange={v => d.setAngled(v === 'angled')} options={[{ value: 'angled', label: 'At an angle' }, { value: 'front', label: 'Dead on' }]}/>}
      </div>
      <small>{clipped ? `As large as fits here: about how it looks from ${Math.round(actual)} ft.` : `About how large it looks from ${feet} ft.`}</small>
    </div>
  </div>;
}

function ChangeRequest({ picture, scores }: { picture: Picture; scores: Scores }) {
  const { say } = useDesign();
  const called = scores.suggestions.filter(s => s.called).map(s => s.id).join(',');
  const [picked, setPicked] = useState<Set<SuggestionId>>(() => new Set(scores.suggestions.filter(s => s.called).map(s => s.id)));
  const [own, setOwn] = useState('');
  // A different picture, or different findings for this one, starts from what the checks call for.
  useEffect(() => { setPicked(new Set(called ? called.split(',') as SuggestionId[] : [])); setOwn(''); }, [picture.id, called]);
  const changes = [...scores.suggestions.filter(s => picked.has(s.id)).map(s => s.text), own];
  const text = buildFollowUp({ position: picture.position, changes });
  const toggle = (id: SuggestionId) => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const copy = () => {
    void copyText(text).then(ok => say(ok
      ? (picture.position ? 'Follow-up copied. Paste it into the same ChatGPT chat as the sheet.' : 'Follow-up copied. Paste it into ChatGPT and attach this picture.')
      : 'Could not copy. Open "Read the follow-up" and copy it by hand.'));
  };
  return <div className="ask">
    <h3>Ask ChatGPT for changes</h3>
    <div className="ask-list">
      {scores.suggestions.map(s => <label key={s.id} className="toggle">
        <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)}/>
        <span>{s.label}{s.called && <em>the checks call for this</em>}</span>
      </label>)}
    </div>
    <input className="own-change" value={own} onChange={e => setOwn(e.target.value)} placeholder="Your own change, such as bigger jowls" aria-label="Your own change"/>
    <button type="button" className="btn strong wide" onClick={copy}>Copy the follow-up</button>
    <Disclosure title="Read the follow-up">
      <p className="follow-up">{text}</p>
    </Disclosure>
  </div>;
}

function Inspector({ picture }: { picture: Picture }) {
  const d = useDesign();
  const { settings } = useStore();
  const judgement = useJudgement(picture);
  const preview = useCutPreview(judgement, 620, d.angled);
  const slabs = effectiveMode(photoBrief(settings)) === 'slabs';
  const active = d.activeId === picture.id;
  const plan = judgement?.plan;
  const at = d.pictures.findIndex(p => p.id === picture.id), count = d.pictures.length;
  const step = (by: number) => d.select(d.pictures[(at + by + count) % count].id);
  return <section className="inspector" aria-label={`${picture.name}: how it carves`}>
    {/* On a narrow screen the tiles are out of sight above; step through the pictures from here. */}
    {count > 1 && <div className="inspector-step">
      <button type="button" className="btn small" onClick={() => step(-1)}>Previous</button>
      <span>{at + 1} of {count}</span>
      <button type="button" className="btn small" onClick={() => step(1)}>Next</button>
    </div>}
    <header className="inspector-head">
      <h2>{picture.name}</h2>
      {judgement && <span className={`verdict ${judgement.scores.verdict}`}>{VERDICT_LABEL[judgement.scores.verdict]}</span>}
    </header>
    <div className="inspector-views">
      <WallView picture={picture} preview={preview} slabs={slabs}/>
      {preview && <figure className="source-view"><img src={picture.dataUrl} alt=""/><figcaption>The picture</figcaption></figure>}
    </div>
    <div className="inspector-actions">
      {active
        ? <button type="button" className="btn" onClick={() => d.setView('tune')}>Fine-tune the cutout and depth</button>
        : <button type="button" className="btn primary" onClick={() => { void d.use(picture.id); }}>Use this one</button>}
      {!active && <button type="button" className="btn" onClick={() => d.remove(picture.id)}>Remove</button>}
    </div>
    {!picture.position && <button type="button" className="link" onClick={() => { void d.quarter(picture.id); }}>Four designs in one picture? Cut it into quarters</button>}
    {judgement ? <>
      <div className="meters">
        <Meter label="Detail kept" value={judgement.scores.detail} note={judgement.scores.notes.detail}/>
        <Meter label="Sturdy" value={judgement.scores.sturdy} note={judgement.scores.notes.sturdy}/>
      </div>
      {judgement.scores.cropped && <p className="hint stale">The subject runs off the edge of the picture, so part of it would be cut flat.</p>}
      {plan && <dl className="facts">
        <div><dt>Pieces</dt><dd>{piecesText(plan)}</dd></div>
        <div><dt>Size</dt><dd>{num(plan.size.width)} × {num(plan.size.height)} in</dd></div>
        <div><dt>Sheets</dt><dd>{rangeText(plan.sheets)}</dd></div>
        <div><dt>Weight</dt><dd>{weightText(plan.weightLb)}</dd></div>
      </dl>}
    </> : <p className="hint">{picture.state === 'failed'
      ? `Judging stopped: ${picture.error ?? 'the depth model did not finish'}.`
      : 'Not judged yet. Judging estimates depth on this device, then draws the picture as it would be cut.'}</p>}
    {judgement && <ChangeRequest picture={picture} scores={judgement.scores}/>}
  </section>;
}

const CONTACT_TILE = 300, CONTACT_PAD = 18;
const WALL_COLOUR = '#e7e2d6';

/** Every judged picture, as cut, numbered on one sheet, for a second opinion from Claude. */
function contactSheet(pictures: Picture[], settings: ReturnType<typeof photoBrief>, angled: boolean): HTMLCanvasElement | null {
  const judged = pictures.map((p, i) => ({ p, i, j: judgePicture(p, settings) })).filter(x => x.j);
  if (!judged.length) return null;
  // As square as the count allows: four make a 2 by 2, like the sheet they came from.
  const perRow = Math.ceil(Math.sqrt(judged.length)), rows = Math.ceil(judged.length / perRow);
  const canvas = document.createElement('canvas');
  canvas.width = perRow * (CONTACT_TILE + CONTACT_PAD) + CONTACT_PAD;
  canvas.height = rows * (CONTACT_TILE + CONTACT_PAD) + CONTACT_PAD;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = WALL_COLOUR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const slabs = effectiveMode(settings) === 'slabs';
  judged.forEach(({ i, j }, k) => {
    const preview = angled && slabs ? renderAnglePreview(settings, j!.field, CONTACT_TILE - 36) : renderFrontPreview(settings, j!.field, CONTACT_TILE - 36);
    const x = CONTACT_PAD + (k % perRow) * (CONTACT_TILE + CONTACT_PAD), y = CONTACT_PAD + Math.floor(k / perRow) * (CONTACT_TILE + CONTACT_PAD);
    if (preview) {
      const tile = document.createElement('canvas');
      tile.width = preview.width; tile.height = preview.height;
      const image = tile.getContext('2d')!.createImageData(preview.width, preview.height);
      image.data.set(preview.rgba);
      tile.getContext('2d')!.putImageData(image, 0, 0);
      ctx.drawImage(tile, x + (CONTACT_TILE - preview.width) / 2, y + (CONTACT_TILE - preview.height) / 2);
    }
    ctx.fillStyle = '#1b292e';
    ctx.font = '600 26px Barlow, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x + 4, y + 2);
  });
  return canvas;
}

function PicturesView() {
  const d = useDesign();
  const selected = d.pictures.find(p => p.id === d.selectedId) ?? null;
  return <div className="design-body">
    <div className="tiles-wrap">
      {d.oddSplit && <p className="split-note">
        {d.oddSplit.count === 1 ? 'That picture came in as one piece. If it holds four designs, ' : `That sheet came apart into ${d.oddSplit.count}. If it held four designs, `}
        <button type="button" className="link" onClick={() => { void d.quarterLastSheet(); }}>cut it into quarters instead</button>.
      </p>}
      <ul className="tiles" aria-label="Pictures">
        {d.pictures.map((p, i) => <li key={p.id}><Tile picture={p} index={i}/></li>)}
      </ul>
    </div>
    <div className="detail-col">
      {selected
        ? <Inspector picture={selected}/>
        : <p className="design-note">Tap a picture to see how it would carve.</p>}
    </div>
  </div>;
}

/** Step two for photo builds: pictures come in, get judged as they would be cut, and one is chosen. */
export function DesignStage() {
  const d = useDesign();
  const { reliefBase, settings } = useStore();
  const { pickPhoto } = useActions();
  const { primary } = useNextAction();
  const narrow = useNarrow();
  const canTune = !!reliefBase;
  const view = d.view === 'tune' && canTune ? 'tune' : 'pictures';
  const judged = useMemo(() => d.pictures.filter(p => p.depth).length, [d.pictures]);

  const askClaude = () => {
    const brief = photoBrief(settings);
    const sheet = contactSheet(d.pictures, brief, d.angled);
    if (!sheet) return d.say('Judge the pictures first; Claude is shown them as they would be cut.');
    const png = () => new Promise<Blob>((resolve, reject) => sheet.toBlob(b => b ? resolve(b) : reject(new Error('No image')), 'image/png'));
    const copied = copyImage(png);
    // Opened from the same tap, so no browser treats it as a pop-up.
    window.open(claudeLink(), '_blank', 'noopener');
    void copied.then(async ok => {
      if (ok) return d.say('Contact sheet copied and Claude opened. Paste the picture into the message, then send.');
      downloadBlob(await png(), 'stackcarve-contact-sheet.png');
      d.say('Could not copy the contact sheet, so it was downloaded instead. Attach it to the Claude message.');
    });
  };

  if (!d.pictures.length && !canTune) {
    return <div className="design-stage">
      {narrow && <div className="idea-inline"><h2>What should it be?</h2><IdeaBlock/></div>}
      <div className="design-empty">
        <div className="empty-card">
          <h2>{d.sent ? 'Now paste the picture' : 'Start with an idea or a picture'}</h2>
          <p>{d.sent
            ? 'In ChatGPT, copy the picture it made: press and hold it, or right-click, then Copy image. Come back and paste it, or drop the saved file here.'
            : 'Describe what to make and StackCarve writes the prompt for ChatGPT. Or bring your own picture: paste it, drop it here, or choose photos.'}</p>
          {/* The idea box carries the ChatGPT button; here are the two ways to bring a picture, the next one marked. */}
          <div className="empty-actions">
            <button type="button" className={/^Paste/.test(primary.label) ? 'btn primary' : 'btn'} onClick={() => { void d.paste(); }}>Paste a picture</button>
            <button type="button" className={/^Choose/.test(primary.label) ? 'btn primary' : 'btn'} onClick={pickPhoto}>Choose photos</button>
          </div>
        </div>
      </div>
    </div>;
  }

  return <div className="design-stage">
    {narrow && <div className="idea-inline"><Disclosure title="Idea and prompt" summary={d.idea.trim() || 'none yet'}><IdeaBlock/></Disclosure></div>}
    <div className="design-bar">
      <div className="segmented" role="group" aria-label="Show">
        <button type="button" className={view === 'pictures' ? 'active' : ''} aria-pressed={view === 'pictures'} onClick={() => d.setView('pictures')}>Pictures{d.pictures.length ? ` (${d.pictures.length})` : ''}</button>
        <button type="button" className={view === 'tune' ? 'active' : ''} aria-pressed={view === 'tune'} disabled={!canTune} title={canTune ? undefined : 'Use a picture first'} onClick={() => d.setView('tune')}>Fine-tune</button>
      </div>
      <div className="design-tools">
        {/* On wider screens Paste and Choose photos sit in the side panel; a phone has no panel on show. */}
        {narrow && <button type="button" className="btn small" onClick={() => { void d.paste(); }}>Paste</button>}
        {narrow && <button type="button" className="btn small" onClick={pickPhoto}>Add photos</button>}
        <button type="button" className="btn small" disabled={!judged} title={judged ? 'Copies a numbered sheet of the pictures as cut and opens Claude' : 'Judge the pictures first'} onClick={askClaude}>Ask Claude</button>
      </div>
    </div>
    {view === 'tune' ? <div className="design-tune"><PhotoWorkbench/></div> : <PicturesView/>}
  </div>;
}
