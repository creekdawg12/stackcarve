import * as THREE from 'three';

/** Size of a geometry after the user's rotation, before scaling. Cheap enough to run on every rotation change. */
export function measureOriented(geometry: THREE.BufferGeometry, rotationDeg: { x: number; y: number; z: number }) {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return { width: 0, height: 0, depth: 0 };
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDeg.x), THREE.MathUtils.degToRad(rotationDeg.y), THREE.MathUtils.degToRad(rotationDeg.z), 'XYZ'));
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const stride = Math.max(1, Math.floor(pos.count / 400000));
  for (let i = 0; i < pos.count; i += stride) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    min.min(v); max.max(v);
  }
  return { width: max.x - min.x, height: max.y - min.y, depth: max.z - min.z };
}
