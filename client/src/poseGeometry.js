import {
  CONF_THRESHOLD,
  ROOM_FOOTPRINT as DEFAULT_FOOTPRINT,
  CAMERA_MOUNT as DEFAULT_CAMERA_MOUNT,
  CAMERA_YAW_DEG as DEFAULT_YAW_DEG,
} from './config';

// ===================================================================
// YOLOv8-Poseの2Dキーポイント(画像座標: 640x480, カメラ映像基準)から、
// 部屋のフロア座標(メートル, 部屋中心付近が原点)への簡易マッピングを行うユーティリティ。
// ===================================================================

const IMG_W = 640;
const IMG_H = 480;

function isValidKpt(k) {
  return Array.isArray(k) && k.length >= 3 && k[2] > CONF_THRESHOLD;
}

/**
 * 1人分の生キーポイント配列から、扱いやすい特徴量にまとめる。
 * @param {Array} keypoints - 17個の[x,y,conf]配列
 * @param {{footprint:Array<{x:number,z:number}>, cameraMount:{x:number,y:number,z:number}, cameraYawDeg:number}} [roomConfig]
 *   「部屋の設定」「カメラ位置の設定」タブでユーザーが設定した現在の部屋の形/カメラ設置位置・向き。
 *   省略時はconfig.jsの既定値を使う。
 */
export function analyzePerson(keypoints, roomConfig) {
  if (!Array.isArray(keypoints) || keypoints.length === 0) return null;

  const visible = keypoints.filter(isValidKpt);
  if (visible.length === 0) return null;

  const avgConf = visible.reduce((sum, k) => sum + k[2], 0) / visible.length;

  const xs = visible.map((k) => k[0]);
  const ys = visible.map((k) => k[1]);
  const bbox = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const bboxW = Math.max(bbox.maxX - bbox.minX, 1);
  const bboxH = Math.max(bbox.maxY - bbox.minY, 1);
  const aspectRatio = bboxH / bboxW; // 小さいほど「横たわっている」

  // 腰(11,12)があればそれを、無ければ肩(5,6)、それも無ければ全体平均を使う
  const hipL = keypoints[11];
  const hipR = keypoints[12];
  const shL = keypoints[5];
  const shR = keypoints[6];

  let refX, refY;
  if (isValidKpt(hipL) && isValidKpt(hipR)) {
    refX = (hipL[0] + hipR[0]) / 2;
    refY = (hipL[1] + hipR[1]) / 2;
  } else if (isValidKpt(shL) && isValidKpt(shR)) {
    refX = (shL[0] + shR[0]) / 2;
    refY = (shL[1] + shR[1]) / 2;
  } else {
    refX = (bbox.minX + bbox.maxX) / 2;
    refY = (bbox.minY + bbox.maxY) / 2;
  }

  return {
    avgConf,
    bbox,
    aspectRatio,
    floor: imageToFloor(refX, refY, roomConfig),
    visibleCount: visible.length,
    keypoints,
  };
}

// -------------------------------------------------------------------
// 画像座標(640x480) → 部屋のフロア座標(メートル, 部屋中心付近が原点) への変換。
//
// 「カメラ位置の設定」タブで設定した位置・向き(yaw角度)にカメラを設置し、
// その向きへ水平気味に見ている想定で、
//   ・画像内の左右位置(X)                    → カメラの視線に対して「左右」
//   ・画像内の上下位置(Y, 下ほど画面手前＝カメラに近い) → カメラからの「奥行き」
// という近似でフロア座標を推定する。カメラの向き(forward)とその右方向(right)は
// yaw角度から求め、部屋のfootprint(多角形)をその2方向に投影した範囲を
// 「カメラから見える最大の奥行き/左右の広がり」とみなすことで、
// 長方形以外の部屋の形やカメラの自由配置にも対応できるようにしている。
//
// YOLOv8-Poseは単眼2Dのため本来「奥行き」の情報は得られない点は変わらず、
// あくまで簡易的な近似(パースによる遠近の歪みなどは考慮していない)。
// より正確な位置が必要な場合は、深度カメラや複数カメラでの三角測量への
// 置き換えを推奨します（TODO）。
// -------------------------------------------------------------------
function imageToFloor(imgX, imgY, roomConfig) {
  const footprint = roomConfig?.footprint || DEFAULT_FOOTPRINT;
  const cameraMount = roomConfig?.cameraMount || DEFAULT_CAMERA_MOUNT;
  const yawDeg = roomConfig?.cameraYawDeg ?? DEFAULT_YAW_DEG;

  const yawRad = (yawDeg * Math.PI) / 180;
  const forward = { x: Math.sin(yawRad), z: Math.cos(yawRad) };
  const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };

  // 部屋の footprint をカメラの前方/右方向に投影し、カメラから見た奥行き・左右の
  // 広がりを求める(長方形以外の形やカメラの自由配置でも破綻しないようにするため)。
  let fMax = 0.5;
  let rMin = -0.5;
  let rMax = 0.5;
  (Array.isArray(footprint) && footprint.length > 0 ? footprint : DEFAULT_FOOTPRINT).forEach((p, i) => {
    const relX = p.x - cameraMount.x;
    const relZ = p.z - cameraMount.z;
    const fProj = relX * forward.x + relZ * forward.z;
    const rProj = relX * right.x + relZ * right.z;
    if (i === 0) {
      fMax = fProj;
      rMin = rProj;
      rMax = rProj;
    } else {
      if (fProj > fMax) fMax = fProj;
      if (rProj < rMin) rMin = rProj;
      if (rProj > rMax) rMax = rProj;
    }
  });
  const depthRange = Math.max(fMax, 0.5);
  const lateralSpan = Math.max(rMax - rMin, 0.5);

  const lateral = (imgX / IMG_W) - 0.5; // -0.5(画面左端)〜+0.5(画面右端)
  const depthFrac = 1 - (imgY / IMG_H); // 0(画面下＝カメラの手前)〜1(画面上＝部屋の奥)

  const depthPos = depthFrac * depthRange;
  const lateralPos = rMin + (lateral + 0.5) * lateralSpan;

  return {
    x: cameraMount.x + forward.x * depthPos + right.x * lateralPos,
    z: cameraMount.z + forward.z * depthPos + right.z * lateralPos,
  };
}

/** 2つのフロア座標間の距離(メートル) */
export function floorDistance(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** 指定した矩形の危険エリアに座標が入っているか判定 */
export function isInsideZone(floor, zone) {
  if (!floor) return false;
  return (
    Math.abs(floor.x - zone.x) <= zone.width / 2 &&
    Math.abs(floor.z - zone.z) <= zone.depth / 2
  );
}
