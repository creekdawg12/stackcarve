import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore } from '../store';

export function ModelViewport() {
  const host = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const { mesh, settings, patchSettings } = useStore();
  const wallArt = settings.inputMode !== 'relief' && settings.buildMode !== 'statue';
  const rot = settings.rotationDeg;

  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101418);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
    camera.position.set(7, -9, 6);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    const grid = new THREE.GridHelper(20, 20, 0x46515b, 0x273039);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid, new THREE.HemisphereLight(0xe7f2ff, 0x1c130c, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(4, -5, 8); key.castShadow = true; scene.add(key);
    const model = mesh?.object.clone(true) ?? null;
    modelRef.current = model;
    let transform: TransformControls | null = null;
    if (model) {
      model.rotation.set(
        THREE.MathUtils.degToRad(settings.rotationDeg.x),
        THREE.MathUtils.degToRad(settings.rotationDeg.y),
        THREE.MathUtils.degToRad(settings.rotationDeg.z)
      );
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const d = Math.max(3, sphere.radius * 3.2);
      if (wallArt) {
        // Look at the piece the way it will hang: from in front (+Z), Y up, grid as the wall behind it.
        camera.up.set(0, 1, 0);
        camera.position.set(sphere.center.x + d * .3, sphere.center.y + d * .2, sphere.center.z + d);
        grid.position.set(sphere.center.x, sphere.center.y, box.min.z - sphere.radius * .05);
        key.position.set(sphere.center.x + d, sphere.center.y + d, sphere.center.z + d);
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(box.max.x + sphere.radius * .25, box.min.y, box.max.z), sphere.radius * .6, 0xf0a84b, sphere.radius * .15, sphere.radius * .08);
        scene.add(arrow);
      } else {
        camera.up.set(0, 0, 1);
        camera.position.set(sphere.center.x + d, sphere.center.y - d, sphere.center.z + d * .75);
        grid.position.set(sphere.center.x, sphere.center.y, box.min.z);
      }
      orbit.target.copy(sphere.center);
      camera.near = Math.max(0.001, d / 1000); camera.far = d * 20; camera.updateProjectionMatrix();
      transform = new TransformControls(camera, renderer.domElement);
      transform.setMode('rotate');
      transform.setSpace('world');
      transform.setSize(.8);
      transform.attach(model);
      transform.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
      transform.addEventListener('objectChange', () => {
        patchSettings({ rotationDeg: {
          x: Number(THREE.MathUtils.radToDeg(model.rotation.x).toFixed(2)),
          y: Number(THREE.MathUtils.radToDeg(model.rotation.y).toFixed(2)),
          z: Number(THREE.MathUtils.radToDeg(model.rotation.z).toFixed(2))
        }});
      });
      scene.add(transform.getHelper());
    }
    const resize = () => {
      const r = el.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height))); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let frame = 0;
    const animate = () => { frame = requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); };
    animate();
    return () => { cancelAnimationFrame(frame); ro.disconnect(); orbit.dispose(); transform?.dispose(); renderer.dispose(); renderer.domElement.remove(); modelRef.current = null; };
  }, [mesh, wallArt]);

  // Typed or preset rotations update the displayed model without rebuilding the scene.
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    model.rotation.set(THREE.MathUtils.degToRad(rot.x), THREE.MathUtils.degToRad(rot.y), THREE.MathUtils.degToRad(rot.z));
  }, [rot.x, rot.y, rot.z]);

  return <div className="viewport" ref={host}>
    {!mesh && <div className="empty-state"><strong>Model viewport</strong><span>Load an STL, OBJ, GLB, or generate a mesh from a photo.</span></div>}
    {mesh && <div className="viewport-hint">{wallArt ? 'This is the view from in front of the wall. Orient the model so it faces you with the top up (orange arrow = up).' : 'Drag the rotation rings to orient the model before slicing.'}</div>}
  </div>;
}
