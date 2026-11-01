import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store';
import type { Part2D, Polyline } from '../types';

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

export function SlicesViewport() {
  const host = useRef<HTMLDivElement>(null);
  const { result, selectedPartId, dispatch } = useStore();
  const [explode, setExplode] = useState(.25);

  useEffect(() => {
    if (!host.current || !result) return;
    const el = host.current;
    const mode = result.buildMode;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101418);
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 10000); camera.up.set(0, 0, 1);
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xf6eadc, 0x22170d, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.castShadow = true; scene.add(light);
    const group = new THREE.Group(); scene.add(group);
    const wood = new THREE.MeshStandardMaterial({ color: 0xc08a52, roughness: .72, metalness: .02 });
    const backerMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .8 });
    const selected = new THREE.MeshStandardMaterial({ color: 0xf2ba62, emissive: 0x3c2100, roughness: .65 });
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x6aa487, roughness: .5 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: .35, metalness: .6 });
    const clickable: THREE.Mesh[] = [];
    const t = result.layers[0]?.thickness ?? 0.25;
    const pitchE = result.pitch * (1 + explode);
    const stackStep = (layer: { index: number }) => layer.index * pitchE;
    const slices = result.layers.filter(l => l.parts.some(p => p.role !== 'backer'));
    const vertical = mode === 'slabs' && result.slabDirection === 'vertical';
    let backY = Infinity;

    for (const layer of slices) for (const part of layer.parts) {
      if (part.role === 'backer') continue;
      for (const q of part.outer) backY = Math.min(backY, q.y);
      const geo = new THREE.ExtrudeGeometry(shapeForPart(part), { depth: layer.thickness, bevelEnabled: false, curveSegments: 16 });
      geo.translate(0, 0, stackStep(layer));
      const m = new THREE.Mesh(geo, part.id === selectedPartId ? selected : wood);
      m.userData.partId = part.id; m.userData.layerIndex = layer.index; m.castShadow = true; m.receiveShadow = true; group.add(m); clickable.push(m);
      for (const d of part.dowels) {
        if (d.columnId.startsWith('R')) continue; // rods are drawn once, full length
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(d.diameter / 2, d.diameter / 2, layer.thickness * .92, 20), pinMat);
        pin.rotation.x = Math.PI / 2;
        pin.position.set(d.x, d.y, stackStep(layer) + layer.thickness / 2);
        group.add(pin);
      }
    }
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x4f5d68, roughness: .6 });
    for (const rod of result.rods) {
      const z0 = rod.fromLayer * pitchE;
      const z1 = rod.toLayer * pitchE + t;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rod.holeDiameter * .42, rod.holeDiameter * .42, z1 - z0, 20), rodMat);
      cyl.rotation.x = Math.PI / 2;
      cyl.position.set(rod.x, rod.y, (z0 + z1) / 2);
      group.add(cyl);
      if (rod.spacerLength > 0) for (let i = rod.fromLayer; i < rod.toLayer; i++) {
        const g0 = i * pitchE + t, g1 = (i + 1) * pitchE;
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(rod.holeDiameter * .75, rod.holeDiameter * .75, Math.max(0.01, g1 - g0), 16), sleeveMat);
        sleeve.rotation.x = Math.PI / 2;
        sleeve.position.set(rod.x, rod.y, (g0 + g1) / 2);
        group.add(sleeve);
      }
    }

    // Slabs: the backer plate stands in the wall plane just behind the flat back edges.
    const backer = result.layers.flatMap(l => l.parts).filter(p => p.role === 'backer');
    if (mode === 'slabs' && backer.length && Number.isFinite(backY)) {
      for (const part of backer) {
        const geo = new THREE.ExtrudeGeometry(shapeForPart(part), { depth: t, bevelEnabled: false, curveSegments: 8 });
        // Backer drawing frame: horizontal slabs (x across, y up); vertical slabs (x = -stack, y = up).
        // Stretch the stacking axis by the explode factor, then rotate the plate into the wall plane of
        // the group frame, where the stacking axis is z and depth is y.
        if (vertical) {
          geo.scale(1 + explode, 1, 1);
          geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)));
        } else {
          geo.scale(1, 1 + explode, 1);
          geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
        }
        geo.translate(0, backY, 0);
        const m = new THREE.Mesh(geo, part.id === selectedPartId ? selected : backerMat);
        m.userData.partId = part.id; m.userData.layerIndex = part.layerIndex; m.receiveShadow = true; group.add(m); clickable.push(m);
      }
    }

    const box = new THREE.Box3().setFromObject(group); const size = box.getSize(new THREE.Vector3());
    // Wall plane for context.
    if (mode !== 'statue') {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: .95, side: THREE.DoubleSide });
      const w = Math.max(size.x, size.y, size.z) * 1.6;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, w), wallMat);
      if (mode === 'terraced') {
        wall.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, -0.02);
      } else {
        wall.rotation.x = Math.PI / 2;
        const back = backer.length ? backY - t : backY;
        wall.position.set((box.min.x + box.max.x) / 2, (Number.isFinite(back) ? back : box.min.y) - 0.02, (box.min.z + box.max.z) / 2);
      }
      wall.receiveShadow = true;
      group.add(wall);
    }
    // Terraced: stand the stack up so the wall is vertical and the layers come toward the viewer.
    if (mode === 'terraced') group.rotation.x = Math.PI / 2;
    // Vertical slabs: drawing x is up the wall and the stack runs to the viewer's right.
    if (vertical) group.rotation.y = -Math.PI / 2;

    const worldBox = new THREE.Box3().setFromObject(group); const sphere = worldBox.getBoundingSphere(new THREE.Sphere()); orbit.target.copy(sphere.center);
    const d = Math.max(8, sphere.radius * 2.6);
    if (mode === 'statue') camera.position.set(sphere.center.x + d, sphere.center.y - d, sphere.center.z + d * .7);
    else if (mode === 'terraced') camera.position.set(sphere.center.x + d * .35, sphere.center.y - d, sphere.center.z + d * .25);
    else camera.position.set(sphere.center.x - d * .35, sphere.center.y + d, sphere.center.z + d * .25);
    light.position.copy(camera.position).add(new THREE.Vector3(0, 0, d * .6));
    camera.near = d / 1000; camera.far = d * 20; camera.updateProjectionMatrix();

    const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
    const click = (e: PointerEvent) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1); ray.setFromCamera(mouse,camera); const hit=ray.intersectObjects(clickable)[0]; if(hit){dispatch({type:'selectPart',id:hit.object.userData.partId});dispatch({type:'selectLayer',index:hit.object.userData.layerIndex});}};
    renderer.domElement.addEventListener('pointerdown', click);
    const resize=()=>{const r=el.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();};const ro=new ResizeObserver(resize);ro.observe(el);resize();
    let frame=0;const animate=()=>{frame=requestAnimationFrame(animate);orbit.update();renderer.render(scene,camera)};animate();
    return()=>{cancelAnimationFrame(frame);ro.disconnect();renderer.domElement.removeEventListener('pointerdown',click);orbit.dispose();renderer.dispose();renderer.domElement.remove();};
  }, [result, explode, selectedPartId]);

  if (!result) return <div className="viewport empty-state"><strong>No slices yet</strong><span>Generate the project from the Model tab.</span></div>;
  return <div className="viewport slices-wrap" ref={host}>
    <label className="explode"><span>Exploded view</span><input type="range" min="0" max="2" step="0.05" value={explode} onChange={e=>setExplode(Number(e.target.value))}/><b>{explode.toFixed(2)}×</b></label>
    {result.buildMode!=='statue'&&<div className="viewport-hint">{result.buildMode==='slabs'?(result.slabDirection==='vertical'?'Slabs stack left to right; rods run horizontally through the hidden strip at the back.':'Slabs stack bottom to top; rods run through the hidden strip at the back.'):'Layer 1 sits on the wall; terraces step toward you.'}</div>}
  </div>;
}
