import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store';
import type { Part2D, PipelineResult, Polyline } from '../types';

function toPath(poly: Polyline) {
  const path = new THREE.Path();
  poly.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y));
  path.closePath();
  return path;
}
function shapeForPart(part: Part2D) {
  const shape = new THREE.Shape();
  part.outer.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
  shape.closePath();
  for (const h of [...part.structuralHoles, ...part.hollowCuts]) shape.holes.push(toPath(h));
  for (const d of part.dowels) {
    const hole = new THREE.Path(); hole.absarc(d.x, d.y, d.diameter / 2, 0, Math.PI * 2, true); shape.holes.push(hole);
  }
  return shape;
}

const WOOD = new THREE.MeshStandardMaterial({ color: 0xc08a52, roughness: .72, metalness: .02 });
const BACKER = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .8 });
const SELECTED = new THREE.MeshStandardMaterial({ color: 0xf2ba62, emissive: 0x3c2100, roughness: .65 });
const PIN = new THREE.MeshStandardMaterial({ color: 0x6aa487, roughness: .5 });
const ROD = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: .35, metalness: .6 });
const SLEEVE = new THREE.MeshStandardMaterial({ color: 0x4f5d68, roughness: .6 });
const WALL = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: .95, side: THREE.DoubleSide });

interface Built {
  group: THREE.Group;
  /** Objects whose position along the stack depends on the explode factor. */
  stacked: { obj: THREE.Object3D; layer: number; kind: 'slab' | 'pin' | 'rod' | 'sleeve' | 'backer' | 'wall'; from?: number; to?: number; base?: THREE.Vector3 }[];
  clickable: THREE.Mesh[];
  byPart: Map<string, THREE.Mesh>;
  backY: number;
  t: number;
  vertical: boolean;
}

/** Build the scene once per result; explode and selection are applied afterwards without rebuilding. */
function buildScene(result: PipelineResult): Built {
  const mode = result.buildMode;
  const t = result.layers[0]?.thickness ?? 0.25;
  const vertical = mode === 'slabs' && result.slabDirection === 'vertical';
  const group = new THREE.Group();
  const stacked: Built['stacked'] = [];
  const clickable: THREE.Mesh[] = [];
  const byPart = new Map<string, THREE.Mesh>();
  const slices = result.layers.filter(l => l.parts.some(p => p.role !== 'backer'));
  let backY = Infinity;

  for (const layer of slices) for (const part of layer.parts) {
    if (part.role === 'backer') continue;
    for (const q of part.outer) backY = Math.min(backY, q.y);
    const geo = new THREE.ExtrudeGeometry(shapeForPart(part), { depth: layer.thickness, bevelEnabled: false, curveSegments: 16 });
    const m = new THREE.Mesh(geo, WOOD);
    m.userData.partId = part.id; m.userData.layerIndex = layer.index; m.castShadow = true; m.receiveShadow = true;
    group.add(m); clickable.push(m); byPart.set(part.id, m);
    stacked.push({ obj: m, layer: layer.index, kind: 'slab' });
    for (const d of part.dowels) {
      if (d.columnId.startsWith('R')) continue;
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(d.diameter / 2, d.diameter / 2, layer.thickness * .92, 20), PIN);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(d.x, d.y, 0);
      group.add(pin);
      stacked.push({ obj: pin, layer: layer.index, kind: 'pin', base: new THREE.Vector3(d.x, d.y, layer.thickness / 2) });
    }
  }
  for (const rod of result.rods) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rod.holeDiameter * .42, rod.holeDiameter * .42, 1, 20), ROD);
    cyl.rotation.x = Math.PI / 2;
    group.add(cyl);
    stacked.push({ obj: cyl, layer: rod.fromLayer, kind: 'rod', from: rod.fromLayer, to: rod.toLayer, base: new THREE.Vector3(rod.x, rod.y, 0) });
    if (rod.spacerLength > 0) for (let i = rod.fromLayer; i < rod.toLayer; i++) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(rod.holeDiameter * .75, rod.holeDiameter * .75, 1, 16), SLEEVE);
      sleeve.rotation.x = Math.PI / 2;
      group.add(sleeve);
      stacked.push({ obj: sleeve, layer: i, kind: 'sleeve', from: i, to: i + 1, base: new THREE.Vector3(rod.x, rod.y, 0) });
    }
  }
  const backers = result.layers.flatMap(l => l.parts).filter(p => p.role === 'backer');
  if (mode === 'slabs' && backers.length && Number.isFinite(backY)) {
    for (const part of backers) {
      const geo = new THREE.ExtrudeGeometry(shapeForPart(part), { depth: t, bevelEnabled: false, curveSegments: 8 });
      const m = new THREE.Mesh(geo, BACKER);
      m.userData.partId = part.id; m.userData.layerIndex = part.layerIndex; m.userData.isBacker = true; m.receiveShadow = true;
      group.add(m); clickable.push(m); byPart.set(part.id, m);
      stacked.push({ obj: m, layer: 0, kind: 'backer' });
    }
  }
  if (mode !== 'statue') {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), WALL);
    wall.receiveShadow = true;
    group.add(wall);
    stacked.push({ obj: wall, layer: 0, kind: 'wall' });
  }
  if (mode === 'terraced') group.rotation.x = Math.PI / 2;
  if (vertical) group.rotation.y = -Math.PI / 2;
  return { group, stacked, clickable, byPart, backY, t, vertical };
}

/** Place everything for the current explode factor. Geometry is reused; only transforms change. */
function layout(built: Built, result: PipelineResult, explode: number) {
  const { t, vertical, backY } = built;
  const pitchE = result.pitch * (1 + explode);
  const mode = result.buildMode;
  const slabBox = new THREE.Box3();
  for (const s of built.stacked) {
    if (s.kind === 'slab') { s.obj.position.set(0, 0, s.layer * pitchE); s.obj.updateMatrixWorld(); slabBox.expandByObject(s.obj); }
  }
  // Un-rotated local box of the slabs for wall and backer placement.
  const local = new THREE.Box3();
  for (const s of built.stacked) if (s.kind === 'slab') { const g = (s.obj as THREE.Mesh).geometry; g.computeBoundingBox(); const b = g.boundingBox!.clone().translate(s.obj.position); local.union(b); }
  const size = local.getSize(new THREE.Vector3());
  const center = local.getCenter(new THREE.Vector3());
  for (const s of built.stacked) {
    switch (s.kind) {
      case 'pin': s.obj.position.set(s.base!.x, s.base!.y, s.layer * pitchE + s.base!.z); break;
      case 'rod': {
        const z0 = s.from! * pitchE, z1 = s.to! * pitchE + t;
        s.obj.scale.set(1, Math.max(0.01, z1 - z0), 1);
        s.obj.position.set(s.base!.x, s.base!.y, (z0 + z1) / 2);
        break;
      }
      case 'sleeve': {
        const g0 = s.from! * pitchE + t, g1 = s.to! * pitchE;
        s.obj.scale.set(1, Math.max(0.01, g1 - g0), 1);
        s.obj.position.set(s.base!.x, s.base!.y, (g0 + g1) / 2);
        break;
      }
      case 'backer': {
        // Backer drawing frame: horizontal (x across, y up) or vertical (x = -stack, y = up).
        // Rebuild its transform from scratch each time: stretch the stacking axis by the explode factor.
        const m = new THREE.Matrix4();
        const stretch = 1 + explode;
        if (vertical) {
          m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
          m.multiply(new THREE.Matrix4().makeScale(stretch, 1, 1));
        } else {
          m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
          m.multiply(new THREE.Matrix4().makeScale(1, stretch, 1));
        }
        s.obj.matrixAutoUpdate = false;
        s.obj.matrix.copy(new THREE.Matrix4().makeTranslation(0, backY, 0).multiply(m));
        s.obj.updateMatrixWorld(true);
        break;
      }
      case 'wall': {
        const w = Math.max(size.x, size.y, size.z) * 1.6;
        s.obj.scale.set(w, w, 1);
        if (mode === 'terraced') { s.obj.rotation.set(0, 0, 0); s.obj.position.set(center.x, center.y, -0.02); }
        else {
          const hasBacker = built.stacked.some(b => b.kind === 'backer');
          s.obj.rotation.set(Math.PI / 2, 0, 0);
          s.obj.position.set(center.x, (Number.isFinite(backY) ? backY - (hasBacker ? t : 0) : local.min.y) - 0.02, center.z);
        }
        break;
      }
      default: break;
    }
  }
}

export function SlicesViewport() {
  const host = useRef<HTMLDivElement>(null);
  const { result, selectedPartId, dispatch } = useStore();
  const [explode, setExplode] = useState(.25);
  const scene = useRef<{ built: Built; camera: THREE.PerspectiveCamera; orbit: OrbitControls; fit: () => void } | null>(null);
  const explodeRef = useRef(explode);

  // Scene lifetime: one per result.
  useEffect(() => {
    if (!host.current || !result) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true;
    renderer.domElement.style.touchAction = 'none';
    el.appendChild(renderer.domElement);
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x101418);
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 10000); camera.up.set(0, 0, 1);
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.screenSpacePanning = true;
    sc.add(new THREE.HemisphereLight(0xf6eadc, 0x22170d, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.castShadow = true; sc.add(light);
    const built = buildScene(result);
    sc.add(built.group);
    layout(built, result, explodeRef.current);

    const fit = () => {
      const box = new THREE.Box3().setFromObject(built.group);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const d = Math.max(8, sphere.radius * 2.6);
      orbit.target.copy(sphere.center);
      const mode = result.buildMode;
      if (mode === 'statue') camera.position.set(sphere.center.x + d, sphere.center.y - d, sphere.center.z + d * .7);
      else if (mode === 'terraced') camera.position.set(sphere.center.x + d * .35, sphere.center.y - d, sphere.center.z + d * .25);
      else camera.position.set(sphere.center.x - d * .35, sphere.center.y + d, sphere.center.z + d * .25);
      light.position.copy(camera.position).add(new THREE.Vector3(0, 0, d * .6));
      camera.near = d / 1000; camera.far = d * 20; camera.updateProjectionMatrix();
      orbit.update();
    };
    fit();
    scene.current = { built, camera, orbit, fit };

    const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
    let downAt: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      // A tap selects; a drag orbits. Decide by how far the pointer moved.
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6 || performance.now() - downAt.t > 600) { downAt = null; return; }
      downAt = null;
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(built.clickable)[0];
      if (hit) { dispatch({ type: 'selectPart', id: hit.object.userData.partId }); dispatch({ type: 'selectLayer', index: hit.object.userData.layerIndex }); }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height))); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let frame = 0; const animate = () => { frame = requestAnimationFrame(animate); orbit.update(); renderer.render(sc, camera); }; animate();
    return () => {
      cancelAnimationFrame(frame); ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      orbit.dispose(); renderer.dispose(); renderer.domElement.remove();
      built.group.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
      scene.current = null;
    };
  }, [result, dispatch]);

  // Explode: move things, keep the camera.
  useEffect(() => {
    explodeRef.current = explode;
    if (scene.current && result) layout(scene.current.built, result, explode);
  }, [explode, result]);

  // Selection: swap materials, keep the camera.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const [id, mesh] of s.built.byPart) mesh.material = id === selectedPartId ? SELECTED : (mesh.userData.isBacker ? BACKER : WOOD);
  }, [selectedPartId, result]);

  const zoom = (factor: number) => {
    const s = scene.current; if (!s) return;
    const dir = new THREE.Vector3().subVectors(s.camera.position, s.orbit.target);
    s.camera.position.copy(s.orbit.target).add(dir.multiplyScalar(factor));
    s.orbit.update();
  };

  if (!result) return <div className="viewport empty-state"><strong>No slices yet</strong><span>Generate the project from the Model tab.</span></div>;
  return <div className="viewport slices-wrap" ref={host}>
    <label className="explode"><span>Exploded view</span><input type="range" min="0" max="2" step="0.05" value={explode} onChange={e => setExplode(Number(e.target.value))}/><b>{explode.toFixed(2)}×</b></label>
    <div className="view-buttons">
      <button onClick={() => zoom(0.8)} title="Zoom in" aria-label="Zoom in">+</button>
      <button onClick={() => zoom(1.25)} title="Zoom out" aria-label="Zoom out">−</button>
      <button onClick={() => scene.current?.fit()} title="Fit the whole piece in view">Fit</button>
    </div>
    <div className="viewport-hint">{result.buildMode === 'slabs' ? (result.slabDirection === 'vertical' ? 'Slabs stack left to right; rods run through the hidden back strip.' : 'Slabs stack bottom to top; rods run through the hidden back strip.') : result.buildMode === 'terraced' ? 'Layer 1 sits on the wall; terraces step toward you.' : 'Layers stack bottom to top on the dowels.'} Drag to orbit, pinch or scroll to zoom, two fingers or right-drag to pan, tap a piece to select it.</div>
  </div>;
}
