import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MeshModel } from '../types';
import { repairGeometry } from './repair';

function geometryFromObject(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  root.traverse(obj => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry?.attributes.position) return;
    const g = obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    geometries.push(g);
  });
  if (!geometries.length) throw new Error('No triangle mesh was found in the file.');
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('The mesh groups could not be merged.');
  return merged;
}

export async function loadMeshFile(file: File): Promise<MeshModel> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  let geometry: THREE.BufferGeometry;

  if (ext === 'stl') {
    geometry = new STLLoader().parse(buffer);
  } else if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    geometry = geometryFromObject(new OBJLoader().parse(text));
  } else if (ext === 'glb') {
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    geometry = geometryFromObject(gltf.scene);
  } else {
    throw new Error('Supported mesh formats are STL, OBJ, and GLB.');
  }

  const { geometry: repaired, diagnostics } = repairGeometry(geometry);
  const material = new THREE.MeshStandardMaterial({ color: 0xb98752, roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(repaired, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const object = new THREE.Group();
  object.add(mesh);
  return { object, geometry: repaired, diagnostics, sourceName: file.name };
}

export async function loadMeshFromArrayBuffer(buffer: ArrayBuffer, filename = 'generated.glb'): Promise<MeshModel> {
  const file = new File([buffer], filename, { type: 'model/gltf-binary' });
  return loadMeshFile(file);
}
