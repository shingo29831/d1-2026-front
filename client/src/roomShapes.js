// ===================================================================
// 部屋の間取り(footprint)に関するユーティリティ関数群。
//
// footprint = 部屋を真上から見た多角形の頂点配列
//   [{x, z}, {x, z}, ...]  (メートル単位、部屋のだいたい中央付近が原点)
// 頂点は時計回り/反時計回りどちらでもよい(このファイルの関数はどちらでも動く)。
//
// 「部屋の設定」タブで長方形/L字型/自由な多角形のいずれを選んでも、最終的には
// この footprint という共通の形式に変換してからアプリ全体(3D表示・カメラの
// 壁吸着・検出座標のマッピングなど)で扱う。
// ===================================================================

export function rectFootprint(width, depth) {
  const w = width / 2;
  const d = depth / 2;
  return [
    { x: -w, z: -d },
    { x: w, z: -d },
    { x: w, z: d },
    { x: -w, z: d },
  ];
}

// 長方形(width×depth)の右奥の角を cutW×cutD だけ欠き取ったL字型の部屋。
export function lShapeFootprint(width, depth, cutW, cutD) {
  const w = width / 2;
  const d = depth / 2;
  const cw = Math.min(Math.max(cutW, 0.3), Math.max(width - 0.6, 0.3));
  const cd = Math.min(Math.max(cutD, 0.3), Math.max(depth - 0.6, 0.3));
  return [
    { x: -w, z: -d },
    { x: w - cw, z: -d },
    { x: w - cw, z: -d + cd },
    { x: w, z: -d + cd },
    { x: w, z: d },
    { x: -w, z: d },
  ];
}

export function footprintBounds(footprint) {
  if (!Array.isArray(footprint) || footprint.length === 0) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1, width: 2, depth: 2 };
  }
  const xs = footprint.map((p) => p.x);
  const zs = footprint.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, width: Math.max(maxX - minX, 0.01), depth: Math.max(maxZ - minZ, 0.01) };
}

export function footprintCenter(footprint) {
  const b = footprintBounds(footprint);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

// 各辺を [始点, 終点] の配列として返す(最後の頂点→最初の頂点も含む)
export function footprintEdges(footprint) {
  if (!Array.isArray(footprint) || footprint.length < 2) return [];
  return footprint.map((p, i) => [p, footprint[(i + 1) % footprint.length]]);
}

// 点(px, pz)から多角形の各辺への最近点・内向き法線・距離を求める。
// 「カメラ位置の設定」タブで壁にカメラを吸着させるときに使う。
export function nearestEdgePoint(px, pz, footprint) {
  const edges = footprintEdges(footprint);
  if (edges.length === 0) return null;
  const center = footprintCenter(footprint);
  let best = null;

  edges.forEach(([a, b]) => {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2;
    t = Math.min(1, Math.max(0, t));
    const nx = a.x + abx * t;
    const nz = a.z + abz * t;
    const dx = px - nx;
    const dz = pz - nz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (!best || dist < best.dist) {
      let normalX = -abz;
      let normalZ = abx;
      const normLen = Math.sqrt(normalX * normalX + normalZ * normalZ) || 1;
      normalX /= normLen;
      normalZ /= normLen;
      // 2通りある法線のうち、部屋の中心を向く方(内向き)を採用する
      const toCenterX = center.x - nx;
      const toCenterZ = center.z - nz;
      if (normalX * toCenterX + normalZ * toCenterZ < 0) {
        normalX = -normalX;
        normalZ = -normalZ;
      }
      best = { x: nx, z: nz, dist, normalX, normalZ };
    }
  });

  return best;
}

// レイキャスト法による単純な point-in-polygon 判定
export function pointInPolygon(px, pz, footprint) {
  let inside = false;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const xi = footprint[i].x;
    const zi = footprint[i].z;
    const xj = footprint[j].x;
    const zj = footprint[j].z;
    const intersect = (zi > pz) !== (zj > pz) &&
      px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 内向き法線ベクトル → yaw角度(度, 0=+z方向, 時計回りに増加)
export function normalToYawDeg(nx, nz) {
  const rad = Math.atan2(nx, nz);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

// yaw角度(度) → 正規化された向きベクトル{x, z}
export function yawDegToDir(yawDeg) {
  const rad = (yawDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: Math.cos(rad) };
}
