import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MeshDiagnostics } from '../types';

function signedVolume(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index;
  let volume = 0;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const ia = idx ? idx.getX(i * 3) : i * 3;
    const ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

function reverseWinding(g: THREE.BufferGeometry) {
  if (!g.index) return;
  const arr = Array.from(g.index.array as ArrayLike<number>);
  for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
  g.setIndex(arr);
}

export function repairGeometry(input: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; diagnostics: MeshDiagnostics } {
  let g = input.clone();
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  if (!g.index) {
    const count = g.getAttribute('position').count;
    g.setIndex(Array.from({ length: count }, (_, i) => i));
  }

  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const old = Array.from(g.index!.array as ArrayLike<number>);
  const kept: number[] = [];
  let degenerateTriangles = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < old.length; i += 3) {
    a.fromBufferAttribute(pos, old[i]); b.fromBufferAttribute(pos, old[i + 1]); c.fromBufferAttribute(pos, old[i + 2]);
    const twiceArea = b.clone().sub(a).cross(c.clone().sub(a)).length();
    if (twiceArea < 1e-10) degenerateTriangles++;
    else kept.push(old[i], old[i + 1], old[i + 2]);
  }
  g.setIndex(kept);

  if (signedVolume(g) < 0) reverseWinding(g);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();

  const edgeCounts = new Map<string, number>();
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const tri = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    for (let e = 0; e < 3; e++) {
      const x = tri[e], y = tri[(e + 1) % 3];
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  const messages: string[] = [];
  if (boundaryEdges) messages.push(`${boundaryEdges} boundary edges remain; sections are best effort.`);
  if (nonManifoldEdges) messages.push(`${nonManifoldEdges} non-manifold edges remain; inspect contours before cutting.`);
  if (degenerateTriangles) messages.push(`${degenerateTriangles} degenerate triangles were removed.`);
  if (!messages.length) messages.push('Mesh edge topology is manifold after vertex welding.');

  return {
    geometry: g,
    diagnostics: {
      vertexCount: g.getAttribute('position').count,
      triangleCount: g.index!.count / 3,
      boundaryEdges,
      nonManifoldEdges,
      degenerateTriangles,
      repaired: true,
      messages
    }
  };
}
