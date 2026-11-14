import type { BuildMode, PipelineResult, ProjectSettings } from '../types';
import { LAYER_HARD_LIMIT, LAYER_SOFT_LIMIT, MATERIALS, STOCK_SHEET_AREA, THICKNESS_PRESETS } from '../defaults';
import { area, bounds } from '../geometry/polygon';
import { STYLES, styleOf } from '../presets';
import type { FrontField } from './field';

/**
 * Where the numbers come from: a typical subject (nothing loaded yet), the loaded photo or
 * model (not generated yet), or the generated cut geometry itself.
 */
export type PlanBasis = 'typical' | 'source' | 'actual';

export type Hardware =
  | { kind: 'rods'; count: number; length: number; hole: number; spacers: number; spacerLength: number }
  /** Short dowel pins between neighbouring layers; `longest` exceeds `length` where one pin runs through several. */
  | { kind: 'pins'; count: number; length: number; longest: number; diameter: number };

export interface SheetRange { low: number; likely: number; high: number }

export interface Plan {
  basis: PlanBasis;
  mode: BuildMode;
  photo: boolean;
  pieceWord: 'slab' | 'layer';
  /** Slices that will actually be cut (empty ends dropped, backer plate not counted). */
  pieces: number;
  /** Backer plates and other parts that are not slices. */
  extraParts: number;
  thickness: number;
  gap: number;
  pitch: number;
  /** Finished piece, in inches. */
  size: { width: number; height: number; depth: number };
  /** Outline area of every part, in square inches: what has to fit on the sheets. */
  partArea: number;
  /** Largest part's bounding box, long side first. */
  largest: { long: number; short: number } | null;
  fitsSheet: boolean;
  /** Working sheets (the size set under Sheets). */
  sheets: SheetRange;
  /** Share of a working sheet the parts are expected to take, 1.4 = one and a bit. */
  sheetLoad: number;
  /** 4 × 8 ft sheets to buy. */
  stock: SheetRange;
  hardware: Hardware;
  weightLb: number;
  cost: number | null;
  /** Total length of every cut line, in inches. Known only once generated. */
  cutLength: number | null;
}

interface Piece {
  area: number;
  long: number;
  short: number;
  /** Area left once hollowing has taken out what nobody sees. Defaults to the full area. */
  net?: number;
}

/** The field turned into inches for one set of settings. */
export interface ResolvedField {
  mode: BuildMode;
  photo: boolean;
  /** Inches per cell. */
  cell: number;
  /** Relief depth in front of the wall plane, inches. */
  keep: number;
  /** Height of the front surface above the wall plane per cell, inches; 0 outside the subject. */
  front: Float32Array;
  /** Mesh only: height of the back surface above the wall plane. */
  back: Float32Array | null;
  inside: Uint8Array;
  cols: number;
  rows: number;
  /** Extent, in cells, of what is left of the subject in front of the wall plane. */
  span: { width: number; height: number };
}

export function effectiveMode(settings: ProjectSettings): BuildMode {
  if (settings.inputMode === 'relief') return settings.buildMode === 'slabs' ? 'slabs' : 'terraced';
  return settings.buildMode;
}

export function resolveField(settings: ProjectSettings, field: FrontField): ResolvedField {
  const mode = effectiveMode(settings);
  const photo = settings.inputMode === 'relief';
  const { cols, rows } = field;
  const front = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  let back: Float32Array | null = null;
  let cell: number, keep: number;
  let span = field.span;

  if (photo) {
    const bySubject = settings.relief.sizeTo === 'subject' || field.kind !== 'photo';
    cell = settings.relief.finishedWidth / Math.max(1, bySubject ? field.span.width : field.cols);
    keep = settings.relief.depth;
    const base = mode === 'slabs' ? Math.min(settings.relief.baseDepth, keep) : 0;
    // A mesh field standing in for a photo (not a real case) still reads as fractions of its own depth.
    const norm = field.kind === 'mesh' ? Math.max(1e-6, field.maxBehind) : 1;
    for (let i = 0; i < front.length; i++) {
      if (!field.inside[i]) continue;
      inside[i] = 1;
      front[i] = base + (1 - Math.min(1, field.behind[i] / norm)) * (keep - base);
    }
  } else {
    cell = settings.targetHeight / Math.max(1, field.span.height);
    const wallArt = mode !== 'statue';
    // The sample has no real depth: assume the front half of a head, about half as deep as it is wide.
    const unit = field.kind === 'mesh' ? cell * (wallArt ? settings.wallArt.depthScale : 1) : 0.5 * field.span.width * cell * (wallArt ? settings.wallArt.depthScale : 1);
    const modelDepth = field.maxBehind * unit;
    keep = wallArt && settings.wallArt.reliefDepth > 0 ? Math.min(settings.wallArt.reliefDepth, modelDepth) : modelDepth;
    if (field.behindBack) back = new Float32Array(cols * rows);
    let x0 = cols, x1 = -1, y0 = rows, y1 = -1;
    for (let i = 0; i < front.length; i++) {
      if (!field.inside[i]) continue;
      const f = keep - field.behind[i] * unit;
      if (f <= 0) continue;
      inside[i] = 1;
      front[i] = f;
      if (back && field.behindBack) back[i] = Math.max(0, keep - field.behindBack[i] * unit);
      const x = i % cols, y = (i - x) / cols;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    // A shallow relief keeps only the front of the model, so the piece is smaller than the model's outline.
    if (wallArt && x1 >= x0) span = { width: Math.min(field.span.width, x1 - x0 + 1), height: Math.min(field.span.height, y1 - y0 + 1) };
  }
  return { mode, photo, cell, keep, front, back, inside, cols, rows, span };
}

/** First-fit shelf packing of bounding boxes: a floor on sheets when parts are too big to share one. */
function shelfSheets(pieces: Piece[], innerW: number, innerH: number, gap: number) {
  const W = Math.max(innerW, innerH), H = Math.min(innerW, innerH);
  const items = pieces.map(p => ({ w: p.long + gap, h: p.short + gap })).sort((a, b) => b.h - a.h);
  const sheets: { shelves: { h: number; x: number }[]; used: number }[] = [];
  for (const it of items) {
    let placed = false;
    for (const sh of sheets) {
      for (const shelf of sh.shelves) if (shelf.h >= it.h && shelf.x + it.w <= W + gap) { shelf.x += it.w; placed = true; break; }
      if (placed) break;
      if (sh.used + it.h <= H + gap) { sh.shelves.push({ h: it.h, x: it.w }); sh.used += it.h; placed = true; break; }
    }
    if (!placed) sheets.push({ shelves: [{ h: it.h, x: it.w }], used: it.h });
  }
  return sheets.length;
}

interface Cut {
  pieces: Piece[];
  extra: Piece[];
  nominal: number;
  size: { width: number; height: number; depth: number };
  /** Statues only: areas come from the model's volume, not from a list of pieces. */
  totalArea?: number;
  netArea?: number;
}

function cutTerraced(settings: ProjectSettings, r: ResolvedField): Cut {
  const t = settings.materialThickness;
  const n = Math.max(1, Math.round(r.keep / t));
  const cellArea = r.cell * r.cell;
  const diff = new Float64Array(n + 1);
  const edgeDiff = new Float64Array(n + 2);
  // Highest layer each cell reaches (-1 = none), for outlines and perimeters.
  const top = new Int16Array(r.cols * r.rows).fill(-1);
  // Bounding box of the cells whose highest layer is k; unioned downward afterwards.
  const x0 = new Int32Array(n).fill(r.cols), x1 = new Int32Array(n).fill(-1), y0 = new Int32Array(n).fill(r.rows), y1 = new Int32Array(n).fill(-1);
  const offset = r.keep - n * t;
  let silhouette = 0;
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
    const i = y * r.cols + x;
    if (!r.inside[i]) continue;
    let first = 0, last: number;
    if (r.photo) {
      // Photo terraces: layer k is everything at least k / (n - 1) of the way to the front.
      last = n > 1 ? Math.min(n - 1, Math.floor(r.front[i] * (n - 1) / r.keep + 1e-9)) : 0;
    } else {
      // Mesh terraces: plane sections through the middle of each layer, between the back and front surfaces.
      const b = r.back ? r.back[i] : 0;
      first = Math.max(0, Math.ceil((b - offset) / t - 0.5));
      last = Math.min(n - 1, Math.ceil((r.front[i] - offset) / t - 0.5) - 1);
    }
    if (last < first) continue;
    silhouette++;
    top[i] = last;
    diff[first]++; diff[last + 1]--;
    if (x < x0[last]) x0[last] = x;
    if (x > x1[last]) x1[last] = x;
    if (y < y0[last]) y0[last] = y;
    if (y > y1[last]) y1[last] = y;
  }
  // Outline length per layer: every cell edge between a higher and a lower neighbour is on the
  // outline of each layer in between.
  const edge = (a: number, b: number) => { const lo = Math.min(a, b), hi = Math.max(a, b); if (hi > lo) { edgeDiff[lo + 1]++; edgeDiff[hi + 1]--; } };
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
    const here = top[y * r.cols + x];
    edge(here, x + 1 < r.cols ? top[y * r.cols + x + 1] : -1);
    edge(here, y + 1 < r.rows ? top[(y + 1) * r.cols + x] : -1);
    if (x === 0) edge(here, -1);
    if (y === 0) edge(here, -1);
  }
  for (let k = n - 2; k >= 0; k--) {
    x0[k] = Math.min(x0[k], x0[k + 1]); x1[k] = Math.max(x1[k], x1[k + 1]);
    y0[k] = Math.min(y0[k], y0[k + 1]); y1[k] = Math.max(y1[k], y1[k + 1]);
  }
  const minArea = Math.max(settings.minFeature * settings.minFeature, r.photo ? settings.relief.minIslandArea : 0);
  const kept: (Piece & { outline: number })[] = [];
  let count = 0, edges = 0;
  const basePlate = !r.photo && settings.wallArt.basePlate;
  for (let k = 0; k < n; k++) {
    count += diff[k];
    edges += edgeDiff[k];
    const cells = k === 0 && basePlate ? silhouette : count;
    const a = cells * cellArea;
    if (a < minArea || x1[k] < x0[k]) continue;
    const w = (x1[k] - x0[k] + 1) * r.cell, h = (y1[k] - y0[k] + 1) * r.cell;
    // A staircase of cell edges overstates a smooth outline by 4 / pi.
    kept.push({ area: a, long: Math.max(w, h), short: Math.min(w, h), outline: edges * r.cell * Math.PI / 4 });
  }
  // Hollowing leaves a ring: what the next layer covers, less the glue overlap, comes out.
  if (settings.hollowEnabled) {
    for (let k = 0; k < kept.length; k++) {
      const cap = k < settings.bottomSolidCaps || k >= kept.length - settings.topSolidCaps || (r.photo && settings.reliefBaseSolid && k === 0);
      const next = kept[k + 1];
      if (cap || !next) continue;
      const fromWall = kept[k].area - kept[k].outline * settings.wallThickness;
      const fromNext = next.area - next.outline * settings.overlapMargin;
      const hole = Math.min(fromWall, fromNext);
      if (hole > settings.wallThickness * settings.wallThickness) kept[k].net = kept[k].area - hole;
    }
  }
  const size = { width: r.span.width * r.cell, height: r.span.height * r.cell, depth: n * t };
  return { pieces: kept, extra: [], nominal: n, size };
}

function cutSlabs(settings: ProjectSettings, r: ResolvedField, field: FrontField): Cut {
  const t = settings.materialThickness;
  const gap = Math.max(0, settings.wallArt.slabGap);
  const pitch = t + gap;
  const vertical = settings.wallArt.slabDirection === 'vertical';
  // Photo slabs are laid out across the whole frame and the empty ends dropped; mesh slabs across the model.
  const lines = r.photo ? (vertical ? r.cols : r.rows) : (vertical ? field.span.width : field.span.height);
  const samples = vertical ? r.rows : r.cols;
  const span = lines * r.cell;
  const n = Math.max(1, Math.round((span + gap) / pitch));
  const minArea = Math.max(settings.minFeature * settings.minFeature, r.photo ? settings.relief.minIslandArea : 0);
  const pieces: Piece[] = [];
  const profile = new Float32Array(samples);
  let longest = 0, silhouette = 0;
  for (let i = 0; i < n; i++) {
    let a0: number, a1: number;
    if (r.photo) {
      // The slab shows the closest point anywhere in its band.
      a0 = Math.floor((i * pitch) / r.cell);
      a1 = Math.max(a0, Math.ceil(Math.min(span, i * pitch + t) / r.cell) - 1);
    } else {
      // A mesh slab is the plane section through the middle of its thickness.
      a0 = a1 = Math.floor((i * pitch + t / 2) / r.cell);
    }
    if (a0 >= lines) break;
    profile.fill(0);
    for (let a = a0; a <= Math.min(a1, Math.ceil(lines) - 1); a++) {
      // Vertical slabs count columns from the viewer's left; horizontal slabs count rows from the bottom.
      const line = vertical ? a : (r.photo ? r.rows - 1 - a : Math.floor(field.span.height - (i * pitch + t / 2) / r.cell));
      if (line < 0 || line >= (vertical ? r.cols : r.rows)) continue;
      for (let s = 0; s < samples; s++) {
        const k = vertical ? s * r.cols + line : line * r.cols + s;
        if (!r.inside[k]) continue;
        const d = r.front[k] - (r.back ? r.back[k] : 0);
        if (d > profile[s]) profile[s] = d;
      }
    }
    let areaSum = 0, first = -1, last = -1, deepest = 0;
    for (let s = 0; s < samples; s++) {
      if (profile[s] <= 0) continue;
      areaSum += profile[s] * r.cell;
      if (first < 0) first = s;
      last = s;
      if (profile[s] > deepest) deepest = profile[s];
    }
    if (first < 0) continue;
    const length = (last - first + 1) * r.cell;
    if (areaSum < minArea || length < settings.minFeature) continue;
    const piece: Piece = { area: areaSum, long: Math.max(length, deepest), short: Math.min(length, deepest) };
    if (settings.hollowEnabled && i >= settings.bottomSolidCaps) {
      // What can come out of a slab sits behind the front wall and in front of the hidden back strip.
      const hole = (length - 2 * settings.wallThickness) * (areaSum / length - settings.wallThickness - settings.wallArt.backZoneDepth - settings.overlapMargin / 2) * 0.8;
      if (hole > settings.wallThickness * settings.wallThickness) piece.net = areaSum - hole;
    }
    pieces.push(piece);
    longest = Math.max(longest, length);
    silhouette += length * pitch;
  }
  const extent = pieces.length ? pieces.length * pitch - gap : 0;
  const extra: Piece[] = [];
  if (settings.wallArt.backerPlate && pieces.length) {
    extra.push({ area: silhouette * 0.92, long: Math.max(extent, longest), short: Math.min(extent, longest) });
  }
  const across = (vertical ? r.span.height : r.span.width) * r.cell;
  const size = vertical ? { width: extent, height: across, depth: r.keep } : { width: across, height: extent, depth: r.keep };
  return { pieces, extra, nominal: n, size };
}

function cutStatue(settings: ProjectSettings, r: ResolvedField, field: FrontField): Cut {
  const t = settings.materialThickness;
  const n = Math.max(1, Math.round(settings.targetHeight / t));
  const width = field.span.width * r.cell;
  const depth = field.kind === 'mesh' ? field.maxBehind * r.cell : width * 0.9;
  // An ellipsoid fills about half its bounding box; use that when the mesh volume cannot be trusted.
  const volume = field.kind === 'mesh' && field.volume > 0 ? field.volume * r.cell ** 3 : 0.5 * width * depth * settings.targetHeight;
  const totalArea = volume / t;
  let netArea = totalArea;
  if (settings.hollowEnabled && n > settings.bottomSolidCaps + settings.topSolidCaps) {
    // Treat the average layer as a disc and keep a ring one wall thick; cap layers stay solid.
    const radius = Math.sqrt(totalArea / n / Math.PI);
    const ring = radius > settings.wallThickness ? 1 - (1 - settings.wallThickness / radius) ** 2 : 1;
    const caps = (settings.bottomSolidCaps + settings.topSolidCaps) / n;
    netArea = totalArea * (caps + (1 - caps) * ring);
  }
  return { pieces: [], extra: [], nominal: n, size: { width, height: n * t, depth }, totalArea, netArea };
}

function hardwareFor(settings: ProjectSettings, mode: BuildMode, pieces: number, pitch: number, gap: number): Hardware {
  const t = settings.materialThickness;
  if (mode === 'slabs') {
    return { kind: 'rods', count: pieces >= 2 ? 2 : 0, length: Math.max(0, pieces * pitch - gap), hole: settings.wallArt.rodHoleDiameter, spacers: gap > 0 ? 2 * Math.max(0, pieces - 1) : 0, spacerLength: gap };
  }
  // Two pins at every joint between layers, each long enough to cross it.
  return { kind: 'pins', count: 2 * Math.max(0, pieces - 1), length: 2 * t, longest: 2 * t, diameter: settings.dowelDiameter };
}

function sheetRange(partArea: number, pieces: Piece[], settings: ProjectSettings, nestsInside: boolean): { sheets: SheetRange; load: number; fits: boolean; largest: Plan['largest'] } {
  const innerW = settings.sheetWidth - 2 * settings.sheetEdgeMargin, innerH = settings.sheetHeight - 2 * settings.sheetEdgeMargin;
  const usable = Math.max(1, innerW * innerH);
  // Share of the usable sheet that real nests fill with part outlines, measured across photo and mesh builds.
  const fill = nestsInside ? { best: 0.9, typical: 0.66, worst: 0.52 } : { best: 0.75, typical: 0.6, worst: 0.52 };
  let largest: Plan['largest'] = null;
  for (const p of pieces) if (!largest || p.long * p.short > largest.long * largest.short) largest = { long: p.long, short: p.short };
  const sheetLong = Math.max(innerW, innerH), sheetShort = Math.min(innerW, innerH);
  const fits = pieces.every(p => p.long <= sheetLong + 1e-6 && p.short <= sheetShort + 1e-6);
  // Parts wider than half the sheet cannot interlock their way out of needing room of their own,
  // though hollow rings can sit inside one another, which claws some of that back.
  const big = pieces.filter(p => p.short > sheetShort / 2);
  const floor = big.length ? shelfSheets(big, innerW, innerH, settings.partGap) : 0;
  const count = (share: number, floorShare: number) => Math.max(1, Math.ceil(floor * floorShare - 1e-9), Math.ceil(partArea / (usable * share) - 0.03));
  const sheets = nestsInside
    ? { low: count(fill.best, 0.5), likely: count(fill.typical, 0.75), high: count(fill.worst, 1) }
    : { low: count(fill.best, 1), likely: count(fill.typical, 1), high: count(fill.worst, 1) };
  return { sheets, load: partArea / (usable * fill.typical), fits, largest };
}

function stockOf(sheets: number, settings: ProjectSettings) {
  return Math.ceil((sheets * settings.sheetWidth * settings.sheetHeight) / STOCK_SHEET_AREA - 1e-9);
}

/** Plan from the brief and a front view of the subject, before anything is generated. */
export function estimatePlan(settings: ProjectSettings, field: FrontField): Plan {
  const r = resolveField(settings, field);
  const { mode, photo } = r;
  const t = settings.materialThickness;
  const gap = mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0;
  const pitch = t + gap;
  const cut = mode === 'terraced' ? cutTerraced(settings, r) : mode === 'slabs' ? cutSlabs(settings, r, field) : cutStatue(settings, r, field);
  const all = [...cut.pieces, ...cut.extra];
  const partArea = cut.totalArea ?? all.reduce((s, p) => s + p.area, 0);
  const netArea = cut.netArea ?? all.reduce((s, p) => s + (p.net ?? p.area), 0);
  const pieces = mode === 'statue' ? cut.nominal : cut.pieces.length;
  const nestsInside = settings.hollowEnabled && settings.nestInCutouts && mode !== 'slabs';
  // A statue's layers are rings of unknown size: check only that the footprint fits a sheet.
  const forFit = mode === 'statue' ? [{ area: 0, long: Math.max(cut.size.width, cut.size.depth), short: Math.min(cut.size.width, cut.size.depth) }] : all;
  const sr = sheetRange(partArea, mode === 'statue' ? [] : all, settings, nestsInside);
  const fitCheck = sheetRange(0, forFit, settings, nestsInside);
  const density = MATERIALS[settings.plan.material]?.density ?? MATERIALS.mdf.density;
  const stock = { low: stockOf(sr.sheets.low, settings), likely: stockOf(sr.sheets.likely, settings), high: stockOf(sr.sheets.high, settings) };
  return {
    basis: field.kind === 'sample' ? 'typical' : 'source',
    mode, photo, pieceWord: mode === 'slabs' ? 'slab' : 'layer',
    pieces, extraParts: cut.extra.length, thickness: t, gap, pitch,
    size: cut.size, partArea,
    largest: mode === 'statue' ? fitCheck.largest : sr.largest,
    fitsSheet: fitCheck.fits,
    sheets: sr.sheets, sheetLoad: sr.load, stock,
    hardware: hardwareFor(settings, mode, pieces, pitch, gap),
    weightLb: netArea * t * density / 1728,
    cost: settings.plan.sheetPrice != null ? stock.likely * settings.plan.sheetPrice : null,
    cutLength: null
  };
}

function perimeter(poly: { x: number; y: number }[]) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; sum += Math.hypot(b.x - a.x, b.y - a.y); }
  return sum;
}

/** Plan read straight off the generated geometry: exact pieces, sheets, hardware, weight and cut length. */
export function actualPlan(result: PipelineResult, settings: ProjectSettings): Plan {
  const mode = result.buildMode;
  const t = settings.materialThickness;
  const gap = Math.max(0, result.pitch - t);
  const slices = result.layers.filter(l => l.parts.some(p => p.role !== 'backer'));
  const parts = result.layers.flatMap(l => l.parts);
  let partArea = 0, netArea = 0, cutLength = 0;
  let largest: Plan['largest'] = null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of parts) {
    const outer = area(p.outer);
    partArea += outer;
    netArea += outer - [...p.structuralHoles, ...p.hollowCuts].reduce((s, h) => s + area(h), 0) - p.dowels.reduce((s, d) => s + Math.PI * d.diameter * d.diameter / 4, 0);
    cutLength += perimeter(p.outer) + [...p.structuralHoles, ...p.hollowCuts].reduce((s, h) => s + perimeter(h), 0) + p.dowels.reduce((s, d) => s + Math.PI * d.diameter, 0);
    const b = bounds(p.outer);
    const long = Math.max(b.width, b.height), short = Math.min(b.width, b.height);
    if (!largest || long * short > largest.long * largest.short) largest = { long, short };
    if (p.role !== 'backer') { minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); }
  }
  const spanX = Number.isFinite(minX) ? maxX - minX : 0, spanY = Number.isFinite(minY) ? maxY - minY : 0;
  // Drawing frames differ by mode: terraced parts lie in the wall plane; slabs are drawn length by depth.
  const size = mode === 'terraced' ? { width: spanX, height: spanY, depth: result.achievedDepth }
    : mode === 'slabs' ? (result.slabDirection === 'vertical' ? { width: result.stackExtent, height: spanX, depth: result.achievedDepth } : { width: spanX, height: result.stackExtent, depth: result.achievedDepth })
    : { width: spanX, height: result.achievedHeight, depth: spanY };
  let hardware: Hardware;
  if (mode === 'slabs') {
    hardware = { kind: 'rods', count: result.rods.length, length: result.rods.reduce((m, r) => Math.max(m, r.length), 0), hole: settings.wallArt.rodHoleDiameter, spacers: result.rods.reduce((n, r) => n + r.spacerCount, 0), spacerLength: gap };
  } else {
    // Each column of matching holes takes one pin as long as the layers it passes through.
    const spans = new Map<string, number>();
    for (const p of parts) for (const d of p.dowels) spans.set(d.columnId, (spans.get(d.columnId) ?? 0) + 1);
    const lengths = [...spans.values()].map(n => n * t);
    const longest = lengths.reduce((m, v) => Math.max(m, v), 0);
    hardware = { kind: 'pins', count: lengths.length, length: lengths.length ? Math.min(...lengths) : 2 * t, longest, diameter: settings.dowelDiameter };
  }
  const density = MATERIALS[settings.plan.material]?.density ?? MATERIALS.mdf.density;
  const n = result.sheets.length;
  const sheets = { low: n, likely: n, high: n };
  const stock = { low: result.stockSheets, likely: result.stockSheets, high: result.stockSheets };
  const innerW = settings.sheetWidth - 2 * settings.sheetEdgeMargin, innerH = settings.sheetHeight - 2 * settings.sheetEdgeMargin;
  return {
    basis: 'actual', mode, photo: settings.inputMode === 'relief', pieceWord: mode === 'slabs' ? 'slab' : 'layer',
    pieces: slices.length, extraParts: parts.filter(p => p.role === 'backer').length, thickness: t, gap, pitch: result.pitch,
    size, partArea, largest,
    fitsSheet: true,
    sheets, sheetLoad: partArea / Math.max(1, innerW * innerH * 0.6), stock, hardware,
    weightLb: netArea * t * density / 1728,
    cost: settings.plan.sheetPrice != null ? result.stockSheets * settings.plan.sheetPrice : null,
    cutLength
  };
}

/* ---------- Notes: the go or no-go list on the plan sheet ---------- */

export interface Fix { label: string; patch: Partial<ProjectSettings> }
export interface PlanNote {
  /** ok = passes, info = worth knowing, warn = worth a look, stop = will not work as planned. */
  level: 'ok' | 'info' | 'warn' | 'stop';
  text: string;
  fixes?: Fix[];
}

const fmt = (n: number, digits = 1) => String(Number(n.toFixed(digits)));

function sizePatch(settings: ProjectSettings, scale: number): { patch: Partial<ProjectSettings>; value: number } {
  if (settings.inputMode === 'relief') {
    const value = Math.max(1, Math.floor(settings.relief.finishedWidth * scale * 2) / 2);
    return { patch: { relief: { ...settings.relief, finishedWidth: value } }, value };
  }
  const value = Math.max(1, Math.floor(settings.targetHeight * scale * 2) / 2);
  return { patch: { targetHeight: value }, value };
}

/** Ways to bring the plan inside a sheet budget, found by re-estimating variants of the brief. */
function budgetFixes(settings: ProjectSettings, field: FrontField, budget: number, certain = false): Fix[] {
  const fixes: Fix[] = [];
  // A plan already likely to fit but tight is only fixed by one that fits even at the high end.
  const within = (s: ProjectSettings) => { const p = estimatePlan(s, field); return (certain ? p.stock.high : p.stock.likely) <= budget && p.fitsSheet; };
  // Smaller: step the size down until it fits.
  for (let scale = 0.95; scale >= 0.3; scale -= 0.05) {
    const { patch, value } = sizePatch(settings, scale);
    if (within({ ...settings, ...patch })) {
      fixes.push({ label: `Make it ${fmt(value)} in ${settings.inputMode === 'relief' ? 'wide' : 'tall'}`, patch });
      break;
    }
  }
  const mode = effectiveMode(settings);
  if (mode === 'slabs') {
    for (const g of [0.125, 0.25, 0.375, 0.5, 0.75, 1]) {
      if (g <= settings.wallArt.slabGap + 1e-9) continue;
      const patch = { wallArt: { ...settings.wallArt, slabGap: g } };
      if (within({ ...settings, ...patch })) { fixes.push({ label: `Open the gaps to ${fraction(g)} in`, patch }); break; }
    }
  } else {
    for (const p of THICKNESS_PRESETS) {
      if (p.value <= settings.materialThickness + 1e-9) continue;
      const patch = { materialThickness: p.value };
      if (within({ ...settings, ...patch })) { fixes.push({ label: `Use ${p.label} in stock`, patch }); break; }
    }
  }
  return fixes;
}

/** 0.375 → "3/8", 0.5 → "1/2", otherwise a short decimal. */
export function fraction(value: number): string {
  for (const den of [2, 4, 8, 16, 32]) {
    const num = value * den;
    if (Math.abs(num - Math.round(num)) < 1e-6 && Math.round(num) > 0 && Math.round(num) < den) return `${Math.round(num)}/${den}`;
  }
  return fmt(value, 3);
}

export function planNotes(plan: Plan, settings: ProjectSettings, field: FrontField): PlanNote[] {
  const notes: PlanNote[] = [];
  const innerW = settings.sheetWidth - 2 * settings.sheetEdgeMargin, innerH = settings.sheetHeight - 2 * settings.sheetEdgeMargin;
  const words = plan.pieceWord + 's';

  // 1. Does the biggest part fit the sheet at all?
  if (plan.largest) {
    if (!plan.fitsSheet) {
      const scale = Math.min(Math.max(innerW, innerH) / plan.largest.long, Math.min(innerW, innerH) / plan.largest.short) * 0.98;
      const { patch, value } = sizePatch(settings, scale);
      notes.push({
        level: 'stop',
        text: `The largest part is ${fmt(plan.largest.long)} × ${fmt(plan.largest.short)} in. The ${settings.sheetWidth} × ${settings.sheetHeight} sheet has ${fmt(Math.max(innerW, innerH))} × ${fmt(Math.min(innerW, innerH))} in inside its margins.`,
        fixes: [{ label: `Make it ${fmt(value)} in ${settings.inputMode === 'relief' ? 'wide' : 'tall'}`, patch }]
      });
    } else {
      notes.push({ level: 'ok', text: `Largest part, ${fmt(plan.largest.long)} × ${fmt(plan.largest.short)} in, fits the ${settings.sheetWidth} × ${settings.sheetHeight} sheet.` });
    }
  }

  // 2. Stock on hand.
  const budget = settings.plan.stockOnHand;
  if (budget != null && budget > 0) {
    const have = `${budget} sheet${budget === 1 ? '' : 's'} of 4×8`;
    if (plan.stock.low > budget) {
      notes.push({ level: 'stop', text: `Needs about ${plan.stock.likely} sheets of 4×8. You have ${budget}.`, fixes: budgetFixes(settings, field, budget) });
    } else if (plan.stock.high > budget) {
      notes.push({ level: 'warn', text: `Tight on stock: it may need ${plan.stock.high} sheets of 4×8 and you have ${budget}.`, fixes: budgetFixes(settings, field, budget, true) });
    } else {
      notes.push({ level: 'ok', text: `Fits the ${have} you have.` });
    }
  }

  // 3. How many pieces is sensible.
  if (plan.pieces > LAYER_HARD_LIMIT) {
    notes.push({ level: 'stop', text: `${plan.pieces} ${words} is more than this tool will cut (${LAYER_HARD_LIMIT}). Use thicker stock, wider gaps or a smaller piece.` });
  } else if (plan.pieces > LAYER_SOFT_LIMIT) {
    notes.push({ level: 'warn', text: `${plan.pieces} ${words} is a lot to cut, sand and glue. Thicker stock${plan.mode === 'slabs' ? ' or wider gaps' : ''} brings it down.` });
  } else if (plan.mode === 'terraced' && plan.pieces > 0 && plan.pieces < 5) {
    notes.push({ level: 'warn', text: `Only ${plan.pieces} layers of depth, so the face will read as flat steps. Thinner stock or more depth adds detail.` });
  } else if (plan.mode === 'slabs' && plan.pieces > 0 && plan.pieces < 12) {
    notes.push({ level: 'warn', text: `Only ${plan.pieces} slabs across, so the shape will be coarse. Thinner stock or a narrower gap adds detail.` });
  }

  // 4. Slabs need room behind the visible profile for the rods.
  if (plan.mode === 'slabs') {
    const hidden = plan.photo ? Math.min(settings.relief.baseDepth, settings.relief.depth) : settings.wallArt.backZoneDepth;
    const need = settings.wallArt.rodHoleDiameter + 2 * settings.dowelEdgeClearance;
    if (hidden < need - 1e-6) {
      notes.push({ level: 'warn', text: `The hidden back strip is ${fmt(hidden, 2)} in deep. A ${fmt(settings.wallArt.rodHoleDiameter, 3)} in rod hole needs about ${fmt(need, 2)} in.` });
    } else if (plan.photo && settings.relief.depth - hidden < 0.75) {
      notes.push({ level: 'warn', text: `Only ${fmt(settings.relief.depth - hidden, 2)} in of the depth is visible profile; the rest is the hidden back strip. Add depth for more relief.` });
    }
  }

  // 5. Weight decides how it hangs.
  if (plan.mode !== 'statue' && plan.weightLb > 30) {
    notes.push({ level: 'warn', text: `About ${Math.round(plan.weightLb)} lb on the wall. Plan on a French cleat screwed into studs.` });
  }

  if (plan.basis === 'typical') {
    notes.push({ level: 'info', text: `Figured for a typical ${plan.photo ? 'portrait' : 'model'}. Add your ${plan.photo ? 'photo' : 'model'} and the numbers tighten up.` });
  } else if (plan.basis === 'source') {
    notes.push({ level: 'info', text: `Measured off your ${plan.photo ? 'photo' : 'model'}. Generating gives the exact count, sheets and cut length.` });
  }
  return notes;
}

/* ---------- Compare: what-if rows the user can tap to choose ---------- */

export type CompareKind = 'thickness' | 'gap' | 'style';
export interface CompareRow {
  key: string;
  label: string;
  pieces: number;
  pieceWord: 'slab' | 'layer';
  sheets: SheetRange;
  stock: SheetRange;
  weightLb: number;
  selected: boolean;
  overBudget: boolean;
  patch: Partial<ProjectSettings>;
}

export const GAP_CHOICES = [0, 0.125, 0.25, 0.375, 0.5];

export function compareRows(kind: CompareKind, settings: ProjectSettings, field: FrontField): CompareRow[] {
  const budget = settings.plan.stockOnHand;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const row = (key: string, label: string, patch: Partial<ProjectSettings>, selected: boolean): CompareRow => {
    const p = estimatePlan({ ...settings, ...patch }, field);
    return { key, label, pieces: p.pieces, pieceWord: p.pieceWord, sheets: p.sheets, stock: p.stock, weightLb: p.weightLb, selected, overBudget: budget != null && budget > 0 && p.stock.likely > budget, patch };
  };
  if (kind === 'thickness') {
    const values = THICKNESS_PRESETS.filter(p => p.label !== '23/32');
    const rows = values.map(p => row(p.label, `${p.label} in`, { materialThickness: p.value }, near(settings.materialThickness, p.value)));
    if (!rows.some(r => r.selected)) rows.push(row('custom', `${fmt(settings.materialThickness, 3)} in`, {}, true));
    return rows;
  }
  if (kind === 'gap') {
    const rows = GAP_CHOICES.map(g => row(String(g), g === 0 ? 'Touching' : `${fraction(g)} in gap`, { wallArt: { ...settings.wallArt, slabGap: g }, ...(g === 0 ? {} : { hollowEnabled: false }) }, near(settings.wallArt.slabGap, g)));
    if (!rows.some(r => r.selected)) rows.push(row('custom', `${fmt(settings.wallArt.slabGap, 3)} in gap`, {}, true));
    return rows;
  }
  const current = styleOf(settings);
  return STYLES.filter(s => !(s.needsModel && settings.inputMode === 'relief')).map(s => row(s.id, s.label, s.apply(settings), s.id === current));
}
