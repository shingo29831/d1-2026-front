// ===================================================================
// 部屋の中の「通れない場所」(壁・家具)を判定・回避するためのユーティリティ。
//
// 見守りダッシュボードでダミー人物(「ダミーを置く」ボタンで手動配置する仮の
// 人物)を矢印キーで動かすとき、以前は部屋の外形(footprint)の範囲内にしか
// クランプしておらず、部屋の中に置いた家具や間仕切り壁を無視してすり抜けて
// 移動できてしまっていた。ここでの判定を使って、家具や壁と重なる移動先には
// 進めないようにする。
//
// 【重要】実際のYOLO検出結果(カメラ映像から解析した実在の人物の位置)は
// 座標そのものを勝手に書き換えるとかえって不正確になるため、isPositionBlocked
// による「移動の可否判定」の対象にはしない。ただし、家具・壁と重なった位置に
// そのまま3D表示すると人物が家具や壁にめり込んで見えてしまう(見た目だけの
// 問題)ため、表示位置だけをresolveSafePosition()でごく僅かに家具・壁の外側へ
// 押し出してから描画する(検出データ自体・危険エリア判定などは元の座標のまま
// 使う。あくまで見た目の重なりを解消するための調整)。
// ===================================================================

// 人物1人分のおおよその半径(メートル)。この半径ぶん、家具や壁の外側にも
// 余白を持たせることで、人物の胴体が家具や壁にめり込んで見えるのを防ぐ。
export const PERSON_RADIUS_M = 0.18;

// 壁の厚み(PlaceholderRoom.jsxの壁メッシュ(boxGeometryの幅0.08)と合わせている)
const WALL_THICKNESS_M = 0.08;

/** 点(px,pz)から、線分(ax,az)-(bx,bz)までの最短距離 */
function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * 指定した座標が、いずれかの壁の厚みの中(=壁にめり込む位置)にあるか判定する。
 * @param {{x:number,z:number}} point
 * @param {Array<{x1:number,z1:number,x2:number,z2:number}>} walls
 * @param {number} [personRadius]
 */
export function isBlockedByWalls(point, walls, personRadius = PERSON_RADIUS_M) {
  if (!point || !Array.isArray(walls)) return false;
  const limit = WALL_THICKNESS_M / 2 + personRadius;
  return walls.some((w) => distanceToSegment(point.x, point.z, w.x1, w.z1, w.x2, w.z2) < limit);
}

/**
 * 指定した座標が、いずれかの家具(回転した矩形)の中にあるか判定する。
 * @param {{x:number,z:number}} point
 * @param {Array<{x:number,z:number,width:number,depth:number,rotationDeg?:number}>} furniture
 * @param {number} [personRadius]
 */
export function isBlockedByFurniture(point, furniture, personRadius = PERSON_RADIUS_M) {
  if (!point || !Array.isArray(furniture)) return false;
  return furniture.some((f) => {
    const rotRad = ((f.rotationDeg || 0) * Math.PI) / 180;
    // 家具のローカル座標系(回転前)へ変換してから、軸に沿った矩形として判定する
    const dx = point.x - f.x;
    const dz = point.z - f.z;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const halfW = (f.width || 0.6) / 2 + personRadius;
    const halfD = (f.depth || 0.5) / 2 + personRadius;
    return Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD;
  });
}

/**
 * 指定した座標が、壁または家具のいずれかに重なって「移動できない」位置かどうかを
 * まとめて判定する。
 * @param {{x:number,z:number}} point
 * @param {{walls?:Array, furniture?:Array, includeWalls?:boolean, personRadius?:number}} [options]
 *   includeWalls: 室内の間仕切り壁を判定に含めるか。「部屋の設定」で長方形/L字型
 *   など既定の間取り以外の形を選んでいるときは、間仕切り壁自体が表示されないため
 *   (PlaceholderRoom.jsxのshowInteriorWalls参照)、衝突判定にも含めない。
 */
export function isPositionBlocked(point, { walls, furniture, includeWalls = true, personRadius } = {}) {
  if (includeWalls && isBlockedByWalls(point, walls, personRadius)) return true;
  if (isBlockedByFurniture(point, furniture, personRadius)) return true;
  return false;
}

/** 壁1本ぶん、点(point)が壁の厚み+人物半径の中にめり込んでいたら、その壁と
 * 垂直な方向へ最小限だけ押し出した座標を返す(重なっていなければそのまま返す)。 */
function resolveAgainstWall(point, wall, personRadius) {
  const limit = WALL_THICKNESS_M / 2 + personRadius;
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return point;
  let t = ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = wall.x1 + t * dx;
  const projZ = wall.z1 + t * dz;
  const offX = point.x - projX;
  const offZ = point.z - projZ;
  const dist = Math.hypot(offX, offZ);
  // dist===0(壁の真上)は押し出す向きが定まらないため諦める(実運用ではまず起きない)。
  if (dist >= limit || dist < 1e-6) return point;
  const scale = limit / dist;
  return { x: projX + offX * scale, z: projZ + offZ * scale };
}

/** 家具1点ぶん、point(x,z)が家具の矩形(+人物半径ぶんの余白)の中に入っていたら、
 * 重なりが最も小さい辺(最小移動量)の外側へ押し出した座標を返す。 */
function resolveAgainstFurniture(point, f, personRadius) {
  const rotRad = ((f.rotationDeg || 0) * Math.PI) / 180;
  const dx = point.x - f.x;
  const dz = point.z - f.z;
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const halfW = (f.width || 0.6) / 2 + personRadius;
  const halfD = (f.depth || 0.5) / 2 + personRadius;
  if (Math.abs(localX) > halfW || Math.abs(localZ) > halfD) return point; // 重なっていない

  const overlapX = halfW - Math.abs(localX);
  const overlapZ = halfD - Math.abs(localZ);
  let pushLocalX = localX;
  let pushLocalZ = localZ;
  if (overlapX < overlapZ) {
    pushLocalX = localX >= 0 ? halfW : -halfW;
  } else {
    pushLocalZ = localZ >= 0 ? halfD : -halfD;
  }
  // ローカル座標(家具の回転前)からワールド座標へ戻す
  const cosBack = Math.cos(rotRad);
  const sinBack = Math.sin(rotRad);
  return {
    x: f.x + (pushLocalX * cosBack - pushLocalZ * sinBack),
    z: f.z + (pushLocalX * sinBack + pushLocalZ * cosBack),
  };
}

/**
 * 家具・壁に重なっている座標を、見た目上めり込まない位置までごく僅かに
 * 押し出す(検出データ自体は書き換えず、3D表示の座標だけを調整する用途)。
 * 家具・壁が複数近接しているケースにも対応できるよう、数回繰り返して解決する。
 * @param {{x:number,z:number}} point
 * @param {{walls?:Array, furniture?:Array, personRadius?:number, iterations?:number}} [options]
 */
export function resolveSafePosition(point, { walls, furniture, personRadius = PERSON_RADIUS_M, iterations = 3 } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return point;
  let p = { x: point.x, z: point.z };
  const wallList = Array.isArray(walls) ? walls : [];
  const furnitureList = Array.isArray(furniture) ? furniture : [];
  for (let i = 0; i < iterations; i++) {
    let moved = false;
    furnitureList.forEach((f) => {
      const next = resolveAgainstFurniture(p, f, personRadius);
      if (next.x !== p.x || next.z !== p.z) { p = next; moved = true; }
    });
    wallList.forEach((w) => {
      const next = resolveAgainstWall(p, w, personRadius);
      if (next.x !== p.x || next.z !== p.z) { p = next; moved = true; }
    });
    if (!moved) break;
  }
  return p;
}
