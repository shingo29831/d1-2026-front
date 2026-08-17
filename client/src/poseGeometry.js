import {
  CONF_THRESHOLD,
  ROOM_FOOTPRINT as DEFAULT_FOOTPRINT,
  CAMERA_MOUNT as DEFAULT_CAMERA_MOUNT,
  CAMERA_YAW_DEG as DEFAULT_YAW_DEG,
  CAMERA_PITCH_DEG as DEFAULT_PITCH_DEG,
  CAMERA_FOV_DEG as DEFAULT_FOV_DEG,
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

  // 【精度向上】床の座標を正確に計算するため、人物の「中心」ではなく「足元（接地点）」を基準にする。
  // 足首(15,16) -> 膝(13,14) -> 腰(11,12) -> バウンディングボックス下端 の順でフォールバック。
  const ankleL = keypoints[15];
  const ankleR = keypoints[16];
  const kneeL = keypoints[13];
  const kneeR = keypoints[14];
  const hipL = keypoints[11];
  const hipR = keypoints[12];

  let refX, refY;
  if (isValidKpt(ankleL) && isValidKpt(ankleR)) {
    refX = (ankleL[0] + ankleR[0]) / 2;
    refY = (ankleL[1] + ankleR[1]) / 2;
  } else if (isValidKpt(kneeL) && isValidKpt(kneeR)) {
    refX = (kneeL[0] + kneeR[0]) / 2;
    refY = (kneeL[1] + kneeR[1]) / 2;
  } else if (isValidKpt(hipL) && isValidKpt(hipR)) {
    refX = (hipL[0] + hipR[0]) / 2;
    refY = (hipL[1] + hipR[1]) / 2;
  } else {
    refX = (bbox.minX + bbox.maxX) / 2;
    refY = bbox.maxY; // 足が見えない場合は枠の一番下（床に近い部分）を使用
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
// 【精度向上】透視投影（レイキャスト）モデルへのアップグレード
// 以前の「画像の上下位置を部屋の奥行き割合にマッピングする」簡易近似を廃止し、
// カメラの「高さ(Y)」「下向き角度(Pitch)」「左右角度(Yaw)」「視野角(FOV)」を
// 用いて、カメラから画像上のピクセルへ向かって3D空間に仮想の光線（レイ）を飛ばし、
// それが床面（Y=0）と交差する座標を数学的に算出する方式に変更しました。
// これにより、パース（遠近感）が正確に反映され、単眼カメラでも高い精度で
// 床の上の位置（メートル）を特定できるようになります。
// -------------------------------------------------------------------
export function imageToFloor(imgX, imgY, roomConfig) {
  const cameraMount = roomConfig?.cameraMount || DEFAULT_CAMERA_MOUNT;
  const yawDeg = roomConfig?.cameraYawDeg ?? DEFAULT_YAW_DEG;
  const pitchDeg = roomConfig?.cameraPitchDeg ?? DEFAULT_PITCH_DEG;
  const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;

  // 1. 画像座標を正規化デバイス座標 (NDC: -1.0 〜 1.0) に変換
  // Three.jsのカメラ座標系に合わせ、上方向が+Y、右方向が+X
  const ndcX = (imgX / IMG_W) * 2 - 1;
  const ndcY = 1 - (imgY / IMG_H) * 2;

  // 2. カメラのローカル空間でのレイ（方向ベクトル）を計算
  const aspect = IMG_W / IMG_H;
  const tanFov = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  
  // カメラは-Z方向を向いている前提
  const localDir = {
    x: ndcX * aspect * tanFov,
    y: ndcY * tanFov,
    z: -1.0
  };

  // 3. Pitch（上下角度）の回転を適用（X軸周りの回転）
  // pitchDegは正の値が「下向き」としてUIで定義されているため、数学的には負の回転
  const pitchRad = (-pitchDeg * Math.PI) / 180;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  
  const pitchDir = {
    x: localDir.x,
    y: localDir.y * cosP - localDir.z * sinP,
    z: localDir.y * sinP + localDir.z * cosP
  };

  // 4. Yaw（左右角度）の回転を適用（Y軸周りの回転）
  // Yawは真上から見て時計回り（北=0, 東=90）の定義。
  const yawRad = (-yawDeg * Math.PI) / 180;
  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);

  const worldDir = {
    x: pitchDir.x * cosY + pitchDir.z * sinY,
    y: pitchDir.y,
    z: -pitchDir.x * sinY + pitchDir.z * cosY
  };

  // 5. レイと床面（Y=0）の交差判定
  // カメラの高さ(cameraMount.y)から、レイがどれくらいの距離(t)で床に到達するか計算
  if (worldDir.y >= 0) {
    // レイが水平または上を向いている（床と交差しない＝空や遠くの壁を見ている）場合
    // 計算不能なため、カメラの正面遠方（仮に10m先）の座標を返す
    return {
      x: cameraMount.x + worldDir.x * 10,
      z: cameraMount.z + worldDir.z * 10,
    };
  }

  const t = -cameraMount.y / worldDir.y;

  // 交差点（床の上の座標）
  return {
    x: cameraMount.x + worldDir.x * t,
    z: cameraMount.z + worldDir.z * t,
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
