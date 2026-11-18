/**
 * Reading a pasted picture: is the background plain (or transparent), where is the subject, and
 * is this really a sheet of several designs? Pure pixel work on a small copy of the picture, so
 * it runs the same in the browser and in tests.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

export type BackgroundKind = 'alpha' | 'plain' | 'busy';

export interface Background {
  kind: BackgroundKind;
  /** The plain colour behind the subject, when there is one. */
  color: [number, number, number] | null;
  /** 255 where the subject is, 0 for background. Null when the background is busy. */
  mask: Uint8Array | null;
}

export interface SubjectPart {
  /** Crop to take from the picture, in the pixel grid that was analysed. Includes a margin. */
  crop: Box;
  /** The subject alone inside that crop: 255 = subject. Width and height are those of the crop. */
  mask: Uint8Array;
  /** Where it sat on the sheet ("top left"), or null when the picture holds one subject. */
  position: string | null;
}

export interface SplitPlan {
  background: Background;
  /** One entry per subject. A single entry with a null mask means "use the whole picture as it is". */
  parts: (SubjectPart | { crop: Box; mask: null; position: null })[];
}

const boxW = (b: Box) => b.x1 - b.x0 + 1;
const boxH = (b: Box) => b.y1 - b.y0 + 1;

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Label 4-connected regions of a 0/255 mask; label 0 is background. */
export function labelRegions(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const areas: number[] = [0];
  const boxes: Box[] = [{ x0: 0, y0: 0, x1: 0, y1: 0 }];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let area = 0, x0 = width, x1 = -1, y0 = height, y1 = -1;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      area++;
      const x = i % width, y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = id; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = id; stack.push(i + width); }
    }
    areas.push(area);
    boxes.push({ x0, y0, x1, y1 });
  }
  return { labels, areas, boxes };
}

/** Fill background pockets enclosed by the subject, but only small ones: a big one is a real opening. */
function fillSmallHoles(mask: Uint8Array, width: number, height: number, maxShare: number) {
  const inverse = new Uint8Array(mask.length);
  let subject = 0;
  for (let i = 0; i < mask.length; i++) { if (mask[i]) subject++; else inverse[i] = 255; }
  const { labels, areas, boxes } = labelRegions(inverse, width, height);
  const out = new Uint8Array(mask);
  const fill = new Uint8Array(areas.length);
  for (let id = 1; id < areas.length; id++) {
    const b = boxes[id];
    const touchesEdge = b.x0 === 0 || b.y0 === 0 || b.x1 === width - 1 || b.y1 === height - 1;
    if (!touchesEdge && areas[id] <= subject * maxShare) fill[id] = 1;
  }
  for (let i = 0; i < out.length; i++) if (fill[labels[i]]) out[i] = 255;
  return out;
}

/** Otsu's threshold over a histogram of 0 to 441 (the longest distance between two RGB colours). */
function otsu(hist: Float64Array, total: number) {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < hist.length; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return best;
}

/**
 * Work out what is behind the subject. Transparent pixels win; otherwise the picture's rim is
 * sampled, and if nearly all of it is one colour the background is plain and can be keyed out.
 */
export function readBackground(img: Pixels): Background {
  const { width, height, data } = img;
  const n = width * height;
  let clear = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) clear++;
  if (clear > n * 0.03 && clear < n * 0.97) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 255 : 0;
    return { kind: 'alpha', color: null, mask };
  }

  // The rim: a band 3% of the short side wide, all the way round.
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const rim: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= band && x < width - band && y >= band && y < height - band) continue;
    const i = (y * width + x) * 4;
    rim.push(i);
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  const color: [number, number, number] = [median(rs), median(gs), median(bs)];
  const dist = (i: number) => Math.hypot(data[i] - color[0], data[i + 1] - color[1], data[i + 2] - color[2]);
  let agree = 0;
  for (const i of rim) if (dist(i) <= 30) agree++;
  // A subject that runs off one edge (a bust cut at the neck) still leaves most of the rim plain.
  if (agree < rim.length * 0.8) return { kind: 'busy', color: null, mask: null };

  const hist = new Float64Array(442);
  for (let i = 0; i < n; i++) hist[Math.min(441, Math.round(dist(i * 4)))]++;
  // Otsu lands midway between background and subject; lean toward the background so pale parts
  // of the subject stay in, without letting compression noise or a faint shadow through.
  const threshold = Math.max(26, Math.min(64, otsu(hist, n) * 0.45));
  let mask = new Uint8Array(n);
  let on = 0;
  for (let i = 0; i < n; i++) if (dist(i * 4) > threshold) { mask[i] = 255; on++; }
  if (on < n * 0.01 || on > n * 0.97) return { kind: 'busy', color: null, mask: null };
  mask = fillSmallHoles(mask, width, height, 0.04);
  return { kind: 'plain', color, mask };
}

interface Group { ids: number[]; area: number; box: Box }

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const gapBetween = (a: Box, b: Box) => Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1) - 1, Math.max(a.y0 - b.y1, b.y0 - a.y1) - 1);
function overlapShare(a: Box, b: Box) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1, h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(boxW(a) * boxH(a), boxW(b) * boxH(b));
}

/** The separate subjects in a mask, biggest pieces first merged with their stray bits, in reading order. */
export function findSubjects(mask: Uint8Array, width: number, height: number): { groups: Group[]; labels: Int32Array } {
  const { labels, areas, boxes } = labelRegions(mask, width, height);
  const n = width * height;
  let largest = 0;
  for (let id = 1; id < areas.length; id++) largest = Math.max(largest, areas[id]);
  const major: Group[] = [];
  const minor: number[] = [];
  const long = Math.max(width, height);
  for (let id = 1; id < areas.length; id++) {
    const b = boxes[id];
    // Line work somebody drew between the designs is not part of any of them: a hairline running a
    // quarter of the picture or more, or a cross, grid or frame, which covers almost none of its own box.
    const reach = Math.max(boxW(b), boxH(b)) >= long * 0.25;
    const hairline = Math.min(boxW(b), boxH(b)) <= Math.max(2, long * 0.015);
    const outline = areas[id] < boxW(b) * boxH(b) * 0.06;
    if (reach && (hairline || outline)) continue;
    if (areas[id] >= Math.max(n * 0.012, largest * 0.12)) major.push({ ids: [id], area: areas[id], box: b });
    else if (areas[id] >= Math.max(6, n * 0.0002)) minor.push(id);
  }
  // Two big regions whose boxes overlap heavily are one subject in two pieces.
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < major.length; i++) for (let j = i + 1; j < major.length; j++) {
      if (overlapShare(major[i].box, major[j].box) > 0.3) {
        major[i] = { ids: [...major[i].ids, ...major[j].ids], area: major[i].area + major[j].area, box: union(major[i].box, major[j].box) };
        major.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  // Stray bits (an ear tip, a speck of shadow) join the nearest subject if they are close to it.
  const reach = Math.max(width, height) * 0.03;
  for (const id of minor) {
    let best = -1, bestGap = Infinity;
    for (let g = 0; g < major.length; g++) {
      const gap = gapBetween(major[g].box, boxes[id]);
      if (gap < bestGap) { bestGap = gap; best = g; }
    }
    if (best >= 0 && bestGap <= reach) {
      major[best].ids.push(id);
      major[best].area += areas[id];
      major[best].box = union(major[best].box, boxes[id]);
    }
  }
  // Reading order: rows from the top, each row left to right.
  const rowHeight = median(major.map(g => boxH(g.box))) || 1;
  const centre = (g: Group) => ({ x: (g.box.x0 + g.box.x1) / 2, y: (g.box.y0 + g.box.y1) / 2 });
  const sorted = [...major].sort((a, b) => centre(a).y - centre(b).y);
  const rows: Group[][] = [];
  for (const g of sorted) {
    const row = rows[rows.length - 1];
    if (row && centre(g).y - centre(row[0]).y < rowHeight * 0.5) row.push(g);
    else rows.push([g]);
  }
  for (const row of rows) row.sort((a, b) => centre(a).x - centre(b).x);
  return { groups: rows.flat(), labels };
}

/** Name each subject by where it sits, the way you would point at it: "top left", "middle", "third". */
export function positionNames(boxes: Box[]): string[] {
  const count = boxes.length;
  const cy = (b: Box) => (b.y0 + b.y1) / 2;
  const rowHeight = median(boxes.map(boxH)) || 1;
  // boxes arrive in reading order; rebuild the rows to know the layout
  const rows: Box[][] = [];
  for (const b of boxes) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(cy(b) - cy(row[0])) < rowHeight * 0.5) row.push(b);
    else rows.push([b]);
  }
  const across = (i: number, len: number) => len === 1 ? '' : len === 2 ? ['left', 'right'][i] : len === 3 ? ['left', 'middle', 'right'][i] : '';
  const down = (i: number, len: number) => len === 1 ? '' : len === 2 ? ['top', 'bottom'][i] : len === 3 ? ['top', 'middle', 'bottom'][i] : '';
  const regular = rows.length <= 3 && rows.every(r => r.length <= 3) && rows.every(r => r.length === rows[0].length);
  if (regular && count > 1) {
    const names: string[] = [];
    rows.forEach((row, r) => row.forEach((_, c) => names.push([down(r, rows.length), across(c, row.length)].filter(Boolean).join(' '))));
    if (names.every(Boolean) && new Set(names).size === count) return names;
  }
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  return boxes.map((_, i) => `${ordinal[i] ?? `number ${i + 1}`} (counting left to right, top to bottom)`);
}

function padded(box: Box, width: number, height: number, share = 0.07): Box {
  const pad = Math.max(2, Math.round(Math.max(boxW(box), boxH(box)) * share));
  return { x0: Math.max(0, box.x0 - pad), y0: Math.max(0, box.y0 - pad), x1: Math.min(width - 1, box.x1 + pad), y1: Math.min(height - 1, box.y1 + pad) };
}

/** Most designs a sheet may hold before it is treated as one busy picture. */
export const MAX_TAKES = 6;

/**
 * Decide how to take a picture apart. A plain or transparent background with two to six separate
 * subjects is a sheet: each subject becomes its own picture with its own cutout. One subject is
 * cropped to itself. Anything else is passed through whole, for the cutout tool to handle later.
 */
export function planSplit(img: Pixels): SplitPlan {
  const { width, height } = img;
  const whole = { crop: { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }, mask: null, position: null } as const;
  const background = readBackground(img);
  if (!background.mask) return { background, parts: [whole] };
  const { groups, labels } = findSubjects(background.mask, width, height);
  if (!groups.length || groups.length > MAX_TAKES) return { background: { ...background, kind: 'busy', mask: null, color: null }, parts: [whole] };

  const names = groups.length > 1 ? positionNames(groups.map(g => g.box)) : [null];
  const parts: SubjectPart[] = groups.map((g, index) => {
    // One subject that nearly fills the frame keeps the frame; cropping would only shave the margin.
    const crop = groups.length === 1 && boxW(g.box) > width * 0.85 && boxH(g.box) > height * 0.85 ? whole.crop : padded(g.box, width, height);
    const cw = boxW(crop), ch = boxH(crop);
    const own = new Uint8Array(labels.length ? Math.max(...g.ids) + 1 : 1);
    for (const id of g.ids) own[id] = 1;
    const mask = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const id = labels[(crop.y0 + y) * width + crop.x0 + x];
      if (id && own[id]) mask[y * cw + x] = 255;
    }
    return { crop, mask, position: names[index] };
  });
  return { background, parts };
}
