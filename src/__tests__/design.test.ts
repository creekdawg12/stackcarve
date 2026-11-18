import { describe, expect, it } from 'vitest';
import { START_SETTINGS, applyStyle } from '../presets';
import { sampleField, type FrontField } from '../plan/field';
import { estimatePlan, resolveField } from '../plan/plan';
import { slabStack } from '../plan/cut';
import { renderAnglePreview, renderFrontPreview } from '../plan/preview';
import { buildFollowUp, buildPrompt, chatGptLink, claudeLink, cleanIdea, CRITIC_PROMPT, LINK_LIMIT, SHEET_TEMPLATE, SINGLE_TEMPLATE } from '../design/prompt';
import { findSubjects, MAX_TAKES, planSplit, positionNames, readBackground, type Pixels } from '../design/split';
import { FAIR, GOOD, maskedBlur, scoreField } from '../design/score';
import { judgePicture, reliefFor, topPick } from '../design/judge';
import { packPicture, unpackPicture } from '../design/storage';
import type { Picture } from '../design/types';
import type { ProjectSettings, ReliefBase } from '../types';

/* ---------- helpers ---------- */

type Rgb = [number, number, number];

function canvas(width: number, height: number, fill: Rgb | null = [255, 255, 255]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (fill) { data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255; }
  }
  return { width, height, data };
}

/** A shaded blob, darker toward its rim like a clay form under soft light. */
function blob(img: Pixels, cx: number, cy: number, rx: number, ry: number, tone = 150) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(img.height - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(img.width - 1, Math.ceil(cx + rx)); x++) {
      const r = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (r > 1) continue;
      const v = Math.round(tone * (1 - 0.45 * r));
      const i = (y * img.width + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = Math.round(v * 0.96); img.data[i + 3] = 255;
    }
  }
}

function sheetOfFour(size = 240): Pixels {
  const img = canvas(size, size);
  const q = size / 2;
  for (const [cx, cy] of [[q / 2, q / 2], [q + q / 2, q / 2], [q / 2, q + q / 2], [q + q / 2, q + q / 2]]) blob(img, cx, cy, q * 0.3, q * 0.38);
  return img;
}

const count = (mask: Uint8Array) => mask.reduce((n, v) => n + (v ? 1 : 0), 0);

/** A copy of the built-in sample face that a test can reshape. */
function face(): FrontField {
  const f = sampleField();
  return { ...f, behind: new Float32Array(f.behind), inside: new Uint8Array(f.inside) };
}

const slabs = (thickness: number, gap = thickness): ProjectSettings => ({ ...START_SETTINGS, materialThickness: thickness, wallArt: { ...START_SETTINGS.wallArt, slabGap: gap } });
const plaque = (thickness = 0.25): ProjectSettings => ({ ...applyStyle(START_SETTINGS, 'plaque'), materialThickness: thickness });

/* ---------- the prompt ---------- */

describe('prompt for ChatGPT', () => {
  it('puts the idea in as the subject, tidied to one line', () => {
    expect(cleanIdea('  English bulldog face,\n grumpy.  ')).toBe('English bulldog face, grumpy');
    const text = buildPrompt('English bulldog face,\n grumpy.', 'four');
    expect(text).toContain('Subject: English bulldog face, grumpy\n');
    expect(text).not.toContain('{idea}');
  });

  it('asks for four takes on one sheet, each named by where it sits', () => {
    const text = buildPrompt('owl', 'four');
    for (const where of ['Top left:', 'Top right:', 'Bottom left:', 'Bottom right:']) expect(text).toContain(where);
    expect(text).toMatch(/2 by 2 sheet/);
    expect(buildPrompt('owl', 'one')).not.toMatch(/2 by 2/);
  });

  it('carries the recipe the depth model and the slicer need', () => {
    for (const template of [SHEET_TEMPLATE, SINGLE_TEMPLATE]) {
      expect(template).toMatch(/matte medium-gray clay/);
      expect(template).toMatch(/pure white/);
      expect(template).toMatch(/No thin or fragile parts/);
      expect(template).toMatch(/no backing board/);
      expect(template).toMatch(/straight on/);
      expect(template).toContain('{idea}');
      // House style: no em dashes anywhere, the prompt included.
      expect(template).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('uses an edited prompt, and still gets the subject in if the placeholder was deleted', () => {
    expect(buildPrompt('fox', 'four', 'Draw {idea} twice: {idea}')).toBe('Draw fox twice: fox');
    expect(buildPrompt('fox', 'four', 'Draw it in clay.')).toBe('Subject: fox\n\nDraw it in clay.');
    expect(buildPrompt('fox', 'four', '   ')).toBe(buildPrompt('fox', 'four'));
  });

  it('makes a ChatGPT link that carries the whole prompt', () => {
    const prompt = buildPrompt('English bulldog face, grumpy, big jowls', 'four');
    const link = chatGptLink(prompt);
    expect(link.startsWith('https://chatgpt.com/?q=')).toBe(true);
    expect(link.length).toBeLessThan(LINK_LIMIT);
    expect(decodeURIComponent(link.split('?q=')[1])).toBe(prompt);
    // A prompt too long for an address still opens ChatGPT; the text is on the clipboard.
    expect(chatGptLink('x'.repeat(LINK_LIMIT))).toBe('https://chatgpt.com/');
  });

  it('writes a follow-up for one design off the sheet with only the listed changes', () => {
    const text = buildFollowUp({ position: 'bottom left', changes: ['Thicken the ears.', '  ', 'bigger jowls'] });
    expect(text).toContain('only the bottom left design from that sheet');
    expect(text).toContain('- Thicken the ears.\n- bigger jowls.');
    expect(text).toContain('Do not change anything else.');
    expect(buildFollowUp({ position: null, changes: [] })).toMatch(/attached picture[\s\S]*Do not change the design itself\./);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('asks Claude for a blind read of the cut previews', () => {
    expect(CRITIC_PROMPT).toMatch(/five words or fewer/);
    expect(CRITIC_PROMPT).not.toMatch(/bulldog/i);
    expect(decodeURIComponent(claudeLink().split('?q=')[1])).toBe(CRITIC_PROMPT);
  });
});

/* ---------- taking a pasted picture apart ---------- */

describe('reading a pasted picture', () => {
  it('splits a 2 by 2 sheet on white into four pictures in reading order', () => {
    const plan = planSplit(sheetOfFour());
    expect(plan.background.kind).toBe('plain');
    expect(plan.parts).toHaveLength(4);
    expect(plan.parts.map(p => p.position)).toEqual(['top left', 'top right', 'bottom left', 'bottom right']);
    const [a, b, c] = plan.parts;
    expect(a.crop.x1).toBeLessThan(b.crop.x0 + 1);
    expect(a.crop.y1).toBeLessThan(c.crop.y0 + 1);
    for (const part of plan.parts) {
      const w = part.crop.x1 - part.crop.x0 + 1, h = part.crop.y1 - part.crop.y0 + 1;
      expect(part.mask).not.toBeNull();
      expect(part.mask!.length).toBe(w * h);
      // The subject fills most of its crop, with a margin left around it.
      const share = count(part.mask!) / (w * h);
      expect(share).toBeGreaterThan(0.45);
      expect(share).toBeLessThan(0.8);
    }
  });

  it('keeps each cutout to its own subject when crops overlap a neighbour', () => {
    const img = canvas(200, 100);
    blob(img, 52, 50, 34, 40);
    blob(img, 132, 50, 34, 40);   // close enough that padded crops overlap
    const plan = planSplit(img);
    expect(plan.parts.map(p => p.position)).toEqual(['left', 'right']);
    const left = plan.parts[0];
    const w = left.crop.x1 - left.crop.x0 + 1;
    // Nothing from the right-hand subject in the left crop's last columns.
    let stray = 0;
    for (let y = 0; y < left.crop.y1 - left.crop.y0 + 1; y++) if (left.mask![y * w + w - 1]) stray++;
    expect(stray).toBe(0);
  });

  it('reads transparency as the cutout when the picture has it', () => {
    const img = canvas(160, 120, null);
    blob(img, 80, 60, 40, 46);
    const bg = readBackground(img);
    expect(bg.kind).toBe('alpha');
    const plan = planSplit(img);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].position).toBeNull();
    expect(plan.parts[0].mask).not.toBeNull();
  });

  it('crops a lone subject to itself and keeps the frame when it already fills it', () => {
    const small = canvas(240, 240);
    blob(small, 120, 120, 40, 50);
    const part = planSplit(small).parts[0];
    expect(part.crop.x1 - part.crop.x0 + 1).toBeLessThan(140);
    const big = canvas(100, 100);
    blob(big, 50, 50, 47, 47);
    expect(planSplit(big).parts[0].crop).toEqual({ x0: 0, y0: 0, x1: 99, y1: 99 });
  });

  it('passes an ordinary photo through whole, for the cutout tool', () => {
    const img = canvas(120, 120);
    // A busy scene: a gradient with texture right to the rim.
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
      const i = (y * 120 + x) * 4;
      img.data[i] = (x * 2 + (y * 37) % 60) % 256; img.data[i + 1] = (y * 2 + (x * 13) % 70) % 256; img.data[i + 2] = ((x + y) * 3) % 256;
    }
    const plan = planSplit(img);
    expect(plan.background.kind).toBe('busy');
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].mask).toBeNull();
    expect(plan.parts[0].crop).toEqual({ x0: 0, y0: 0, x1: 119, y1: 119 });
  });

  it('ignores labels and specks, and keeps a stray bit with the subject it belongs to', () => {
    const img = sheetOfFour(240);
    blob(img, 8, 8, 2, 2, 40);            // a panel number ChatGPT drew anyway
    blob(img, 232, 232, 2, 2, 40);
    blob(img, 60, 5, 5, 3);              // a detached tuft just above the top-left head
    const { groups } = findSubjects(readBackground(img).mask!, 240, 240);
    expect(groups).toHaveLength(4);
    expect(groups[0].ids.length).toBe(2);
    expect(groups[0].box.y0).toBeLessThan(6);
  });

  it('ignores divider lines and frames drawn between the designs', () => {
    const img = sheetOfFour(240);
    const ink = (x: number, y: number) => { const i = (y * 240 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 150; };
    for (let k = 8; k < 232; k++) { ink(120, k); ink(k, 120); }                              // a cross through the middle
    for (let k = 3; k < 237; k++) { ink(k, 3); ink(k, 236); ink(3, k); ink(236, k); }        // a frame round the lot
    const plan = planSplit(img);
    expect(plan.parts.map(p => p.position)).toEqual(['top left', 'top right', 'bottom left', 'bottom right']);
    // Each crop is still its own quarter, not stretched across the sheet by the line work.
    for (const part of plan.parts) expect(part.crop.x1 - part.crop.x0).toBeLessThan(110);
  });

  it('keeps a pale subject whole on a white background', () => {
    const img = canvas(160, 160);
    blob(img, 80, 80, 50, 60, 205);        // light clay
    blob(img, 80, 70, 10, 8, 252);         // a highlight as bright as the background
    const bg = readBackground(img);
    expect(bg.kind).toBe('plain');
    // The highlight is filled in rather than left as a hole.
    expect(bg.mask![70 * 160 + 80]).toBe(255);
  });

  it('still treats the background as plain when the subject runs off the bottom', () => {
    const img = canvas(160, 160);
    blob(img, 80, 130, 44, 70);
    expect(readBackground(img).kind).toBe('plain');
  });

  it('does not try to split a picture with a crowd of subjects', () => {
    const img = canvas(300, 300);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) blob(img, 50 + c * 100, 50 + r * 100, 28, 28);
    const plan = planSplit(img);
    expect(9).toBeGreaterThan(MAX_TAKES);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].mask).toBeNull();
  });

  it('names positions the way you would point at them', () => {
    const box = (x: number, y: number) => ({ x0: x, y0: y, x1: x + 20, y1: y + 20 });
    expect(positionNames([box(0, 0), box(40, 0), box(80, 0)])).toEqual(['left', 'middle', 'right']);
    expect(positionNames([box(0, 0), box(0, 40)])).toEqual(['top', 'bottom']);
    expect(positionNames([box(0, 0), box(40, 0), box(0, 40)])[2]).toMatch(/^third \(counting/);
  });
});

/* ---------- the carve checks ---------- */

describe('carve checks', () => {
  it('scores the sample face as good to cut at the starting brief', () => {
    const s = scoreField(START_SETTINGS, sampleField());
    expect(s.detail).toBeGreaterThanOrEqual(GOOD);
    expect(s.sturdy).toBe(100);
    expect(s.fragile).toBe(0);
    expect(s.verdict).toBe('cut');
    expect(s.suggestions.filter(x => x.called)).toHaveLength(0);
    expect(s.suggestions.map(x => x.id)).toEqual(['simplify', 'thicken', 'deepen', 'whole']);
  });

  it('keeps more detail as the slabs get finer', () => {
    const f = sampleField();
    const coarse = scoreField(slabs(0.75), f).detail, mid = scoreField(slabs(0.25), f).detail, fine = scoreField(slabs(0.125), f).detail;
    expect(mid).toBeGreaterThan(coarse);
    expect(fine).toBeGreaterThanOrEqual(mid);
    expect(coarse).toBeLessThan(GOOD);
    expect(fine).toBeGreaterThan(90);
  });

  it('keeps more detail as the layers get thinner on a plaque', () => {
    const f = sampleField();
    expect(scoreField(plaque(0.125), f).detail).toBeGreaterThanOrEqual(scoreField(plaque(0.75), f).detail);
    expect(scoreField(plaque(0.125), f).detail).toBeGreaterThan(85);
  });

  it('marks down a surface whose features are finer than the slabs', () => {
    const smooth = face(), fussy = face();
    // Ridges two cells wide running along the slabs: the kind of texture a slab pitch cannot hold.
    for (let y = 0; y < fussy.rows; y++) for (let x = 0; x < fussy.cols; x++) {
      const i = y * fussy.cols + x;
      if (fussy.inside[i]) fussy.behind[i] = Math.max(0, Math.min(1, fussy.behind[i] + 0.12 * Math.sin(x * Math.PI / 2)));
    }
    const settings = slabs(0.5);
    const a = scoreField(settings, smooth), b = scoreField(settings, fussy);
    expect(b.detail).toBeLessThan(a.detail - 10);
    expect(b.suggestions.find(x => x.id === 'simplify')!.called).toBe(true);
    expect(b.suggestions.find(x => x.id === 'simplify')!.text).toMatch(/no feature narrower than about one \w+ of the width/);
  });

  it('counts loose pieces and slivers, and asks for thicker parts', () => {
    const f = face();
    // Thin antennae above the head: every slab they cross gets a second, loose piece.
    for (let k = 0; k < 14; k++) {
      const x0 = 30 + k * 10;
      for (let y = 2; y < 9; y++) for (let x = x0; x < x0 + 2; x++) { f.inside[y * f.cols + x] = 1; f.behind[y * f.cols + x] = 0.6; }
    }
    const s = scoreField(START_SETTINGS, f);
    expect(s.fragile).toBeGreaterThan(5);
    expect(s.sturdy).toBeLessThan(GOOD);
    expect(s.verdict).not.toBe('cut');
    expect(s.suggestions.find(x => x.id === 'thicken')!.called).toBe(true);
    expect(s.notes.sturdy).toMatch(/of \d+ pieces are loose or very small/);
  });

  it('treats anything apart from the main outline as loose on a plaque', () => {
    const f = face();
    for (let y = 2; y < 16; y++) for (let x = 4; x < 20; x++) { f.inside[y * f.cols + x] = 1; f.behind[y * f.cols + x] = 0.9; }
    const s = scoreField(plaque(), f);
    expect(s.fragile).toBeGreaterThanOrEqual(1);
    expect(scoreField(plaque(), sampleField()).fragile).toBe(0);
  });

  it('notices a subject that runs off the picture', () => {
    const f = face();
    for (let y = 0; y < 40; y++) for (let x = 20; x < 180; x++) { f.inside[y * f.cols + x] = 1; if (f.behind[y * f.cols + x] > 0.9) f.behind[y * f.cols + x] = 0.5; }
    const s = scoreField(START_SETTINGS, f);
    expect(s.cropped).toBe(true);
    expect(s.suggestions.find(x => x.id === 'whole')!.called).toBe(true);
    expect(s.verdict).not.toBe('cut');
    expect(scoreField(START_SETTINGS, sampleField()).cropped).toBe(false);
  });

  it('reports an empty subject without dividing by nothing', () => {
    const f = face();
    f.inside.fill(0);
    const s = scoreField(START_SETTINGS, f);
    expect(s).toMatchObject({ detail: 0, sturdy: 0, verdict: 'rework', pieces: 0 });
    expect(Number.isFinite(s.rank)).toBe(true);
  });

  it('gives a verdict from the weaker of the two scores', () => {
    const f = sampleField();
    const coarse = scoreField(slabs(0.75), f);
    expect(Math.min(coarse.detail, coarse.sturdy)).toBeLessThan(GOOD);
    expect(coarse.verdict).toBe(Math.min(coarse.detail, coarse.sturdy) >= FAIR ? 'tweak' : 'rework');
  });

  it('blurs a masked surface without letting the background pull its edge down', () => {
    const cols = 40, rows = 40;
    const values = new Float32Array(cols * rows), inside = new Uint8Array(cols * rows);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { inside[y * cols + x] = 1; values[y * cols + x] = 5; }
    const out = maskedBlur(values, inside, cols, rows, 4);
    expect(out[10 * cols + 10]).toBeCloseTo(5, 4);   // corner of the plateau stays at the plateau's height
    expect(out[20 * cols + 20]).toBeCloseTo(5, 4);
  });

  it('reads the same slabs the planner counts', () => {
    const f = sampleField();
    for (const settings of [START_SETTINGS, slabs(0.5), { ...START_SETTINGS, wallArt: { ...START_SETTINGS.wallArt, slabDirection: 'horizontal' as const } }]) {
      const used = slabStack(settings, resolveField(settings, f)).slabs.filter(s => s.profile.some(v => v > 0)).length;
      expect(Math.abs(used - estimatePlan(settings, f).pieces)).toBeLessThanOrEqual(1);
    }
  });
});

/* ---------- previews ---------- */

describe('angled preview', () => {
  it('shows slab builds from the side: narrower than dead on, with the faces between slabs drawn', () => {
    const f = sampleField();
    const front = renderFrontPreview(START_SETTINGS, f, 300)!, angled = renderAnglePreview(START_SETTINGS, f, 300)!;
    expect(angled.widthIn).toBeLessThan(front.widthIn);
    expect(angled.heightIn).toBeCloseTo(front.heightIn, 0);
    let painted = 0;
    for (let i = 3; i < angled.rgba.length; i += 4) if (angled.rgba[i]) painted++;
    expect(painted / (angled.width * angled.height)).toBeGreaterThan(0.4);
  });

  it('views side-to-side slabs from above, and leaves other styles as the front view', () => {
    const f = sampleField();
    const across = { ...START_SETTINGS, wallArt: { ...START_SETTINGS.wallArt, slabDirection: 'horizontal' as const } };
    const front = renderFrontPreview(across, f, 300)!, angled = renderAnglePreview(across, f, 300)!;
    expect(angled.heightIn).toBeLessThan(front.heightIn + 3);
    expect(angled.widthIn).toBeCloseTo(front.widthIn, 0);
    const p = plaque();
    expect(renderAnglePreview(p, f, 200)!.rgba).toEqual(renderFrontPreview(p, f, 200)!.rgba);
  });
});

/* ---------- judging pictures ---------- */

function picture(id: string, shape: (x: number, y: number) => number, size = 96): Picture {
  const values = new Float32Array(size * size), mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(u / 0.8, v / 0.9);
    if (r >= 1) continue;
    mask[y * size + x] = 255;
    values[y * size + x] = Math.max(0, Math.min(1, shape(u, v) * (0.35 + 0.65 * Math.sqrt(1 - r * r))));
  }
  const depth: ReliefBase = { source: 'depth', width: size, height: size, values };
  return { id, name: id, position: null, dataUrl: `data:image/jpeg;base64,${id}`, mimeType: 'image/jpeg', width: size, height: size, depth, mask, maskFrom: 'plain', state: 'ready', addedAt: 0 };
}

describe('judging pictures', () => {
  it('has nothing to say about a picture without depth', () => {
    const p = { ...picture('a', () => 1), depth: null };
    expect(judgePicture(p, START_SETTINGS)).toBeNull();
    expect(topPick([p], START_SETTINGS)).toBeNull();
  });

  it('judges a picture at the brief, fits the wall plane to it, and reuses the result until the brief changes', () => {
    const p = picture('dome', () => 1);
    const a = judgePicture(p, START_SETTINGS)!;
    expect(a.scores.detail).toBeGreaterThan(0);
    expect(a.plan.pieces).toBeGreaterThan(10);
    expect(a.plan.size.width).toBeCloseTo(START_SETTINGS.relief.finishedWidth, 0);
    expect(judgePicture(p, START_SETTINGS)).toBe(a);
    const thicker = slabs(0.5);
    const b = judgePicture(p, thicker)!;
    expect(b).not.toBe(a);
    expect(b.plan.pieces).toBeLessThan(a.plan.pieces);
    expect(reliefFor(p, START_SETTINGS).depthFloor).toBeGreaterThanOrEqual(0);
    expect(reliefFor(p, START_SETTINGS).source).toBe('depth');
  });

  it('judges as a photo build even while the project is set to a 3D model', () => {
    const p = picture('dome', () => 1);
    const j = judgePicture(p, { ...START_SETTINGS, inputMode: 'mesh' })!;
    expect(j.plan.photo).toBe(true);
  });

  it('picks the picture that carves best', () => {
    const clean = picture('clean', () => 1);
    // Fine ridges across the surface: detail the slabs cannot hold.
    const fussy = picture('fussy', u => 0.8 + 0.2 * Math.sin(u * 90));
    const settings = slabs(0.5);
    expect(judgePicture(fussy, settings)!.scores.rank).toBeLessThan(judgePicture(clean, settings)!.scores.rank);
    expect(topPick([fussy, clean], settings)!.id).toBe('clean');
  });

  it('packs a picture for storage and brings it back', () => {
    const p = picture('keep', () => 1, 32);
    const back = unpackPicture(packPicture(p));
    expect(back.state).toBe('ready');
    expect(back.depth!.values.length).toBe(32 * 32);
    expect(Math.abs(back.depth!.values[32 * 16 + 16] - p.depth!.values[32 * 16 + 16])).toBeLessThan(1 / 255);
    expect(back.mask).toEqual(p.mask);
    // A picture caught mid-judging comes back as simply not judged.
    const waiting = unpackPicture(packPicture({ ...p, depth: null, state: 'judging' }));
    expect(waiting.state).toBe('new');
    expect(waiting.depth).toBeNull();
    // A cutout that no longer matches the grid is dropped rather than trusted.
    const odd = unpackPicture({ ...packPicture(p), mask: new Uint8Array(10) });
    expect(odd.mask).toBeNull();
    expect(odd.maskFrom).toBeNull();
  });
});
