// ===================================================================
// 部屋の中の「通れない場所」(壁・家具)を判定するためのユーティリティ。
//
// 見守りダッシュボードでダミー人物(「ダミーを置く」ボタンで手動配置する仮の
// 人物)を矢印キーで動かすとき、以前は部屋の外形(footprint)の範囲内にしか
// クランプしておらず、部屋の中に置いた家具や間仕切り壁を無視してすり抜けて
// 移動できてしまっていた。ここでの判定を使って、家具や壁と重なる移動先には
// 進めないようにする(実際のYOLO検出結果はカメラ映像の解析からそのまま座標が
// 決まるため、この判定は「ダミー人物の移動」にのみ使う)。
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
