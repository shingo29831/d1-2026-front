import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { footprintEdges } from './roomShapes';

// ===================================================================
// 「部屋の設定」タブ等から呼び出す、現在のリビング(見守り対象の部屋)の
// 3Dデータ書き出し機能。
//
// Polycamの実スキャンモデルを使わず、アプリ内で組み立てているプレース
// ホルダーの部屋(床・壁・家具、PlaceholderRoom.jsxと同じ見た目)を
// そのままThree.jsのシーンとして再構築し、GLTFExporterでGLB
// (バイナリ形式のglTF、単一ファイル)としてエクスポートする。
// Blender/Unity/他の3Dビューアーなどで開ける汎用的な3Dデータとして
// 使えるようにするための機能。
// ===================================================================

function buildWallMesh(a, b, height, color) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.05) return null;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const angle = Math.atan2(dx, dz);
  const geometry = new THREE.BoxGeometry(0.08, height, Math.max(length, 0.01));
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(midX, height / 2, midZ);
  mesh.rotation.y = angle;
  return mesh;
}

function buildFurnitureMesh(item) {
  const width = item.width || 0.6;
  const depth = item.depth || 0.5;
  const height = item.height || 0.5;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({ color: item.color || '#8b6b47', roughness: 0.8 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(item.x, height / 2, item.z);
  mesh.rotation.y = THREE.MathUtils.degToRad(item.rotationDeg || 0);
  mesh.name = item.label || '家具';
  return mesh;
}

function buildZoneMesh(zone) {
  const geometry = new THREE.PlaneGeometry(zone.width, zone.depth);
  const color = zone.type === 'danger' ? '#f43f5e' : '#f59e0b';
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(zone.x, 0.01, zone.z);
  mesh.name = zone.label || 'エリア';
  return mesh;
}

// footprint/height/walls/furniture/zones(すべてroomConfigContextの現在値)から
// 書き出し用のThree.jsシーンを組み立てる。
export function buildLivingRoomScene({ footprint, height, walls, furniture, zones }) {
  const scene = new THREE.Scene();
  scene.name = 'リビング・ダイニング(1F)';

  // 床
  const shape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
  const floorGeometry = new THREE.ShapeGeometry(shape);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#e7ebf2', roughness: 0.9, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.name = '床';
  scene.add(floor);

  // 外壁(部屋の外形の各辺)
  const wallGroup = new THREE.Group();
  wallGroup.name = '壁';
  footprintEdges(footprint).forEach(([a, b]) => {
    const mesh = buildWallMesh(a, b, height, '#94a3b8');
    if (mesh) wallGroup.add(mesh);
  });
  // 室内の間仕切り壁
  (Array.isArray(walls) ? walls : []).forEach((w) => {
    const mesh = buildWallMesh({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 }, Math.min(height, 2.4), '#94a3b8');
    if (mesh) {
      mesh.name = w.label || '間仕切り壁';
      wallGroup.add(mesh);
    }
  });
  scene.add(wallGroup);

  // 危険/注意エリア(床の色付きマーカー)
  if (Array.isArray(zones) && zones.length > 0) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = '危険・注意エリア';
    zones.forEach((z) => zoneGroup.add(buildZoneMesh(z)));
    scene.add(zoneGroup);
  }

  // 家具
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = '家具';
  (Array.isArray(furniture) ? furniture : []).forEach((f) => furnitureGroup.add(buildFurnitureMesh(f)));
  scene.add(furnitureGroup);

  return scene;
}

// シーンをGLB(バイナリglTF)のArrayBufferに変換する
function exportSceneToGlbArrayBuffer(scene) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (result) => resolve(result),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true },
    );
  });
}

// ブラウザでファイルとしてダウンロードさせる
function downloadArrayBuffer(arrayBuffer, filename) {
  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// roomConfig(useRoomConfig()の戻り値)から、現在のリビングの3Dデータ(GLB)を
// 書き出してブラウザでダウンロードさせる。
export async function exportLivingRoomAsGlb(roomConfig, filename = 'living_room.glb') {
  const scene = buildLivingRoomScene(roomConfig);
  const arrayBuffer = await exportSceneToGlbArrayBuffer(scene);
  downloadArrayBuffer(arrayBuffer, filename);
}
