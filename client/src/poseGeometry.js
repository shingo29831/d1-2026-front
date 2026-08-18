import {
  CONF_THRESHOLD,
  ROOM_FOOTPRINT as DEFAULT_FOOTPRINT,
  CAMERA_MOUNT as DEFAULT_CAMERA_MOUNT,
  CAMERA_YAW_DEG as DEFAULT_YAW_DEG,
  CAMERA_PITCH_DEG as DEFAULT_PITCH_DEG,
  CAMERA_FOV_DEG as DEFAULT_FOV_DEG,
} from './config';
import { footprintBounds, pointInPolygon } from './roomShapes';

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
  let aspectRatio = bboxH / bboxW; // 小さいほど「横たわっている」

  // --- 至近距離（ドアップ）判定と距離推定 ---
  const lEye = isValidKpt(keypoints[1]) ? keypoints[1] : null;
  const rEye = isValidKpt(keypoints[2]) ? keypoints[2] : null;
  const lEar = isValidKpt(keypoints[3]) ? keypoints[3] : null;
  const rEar = isValidKpt(keypoints[4]) ? keypoints[4] : null;
  
  let faceWidthPx = 0;
  let actualWidthM = 0;

  // 距離推定用：両耳（顔幅）または両目（瞳孔間距離）のピクセル幅を取得
  if (lEar && rEar) {
    faceWidthPx = Math.abs(lEar[0] - rEar[0]);
    actualWidthM = 0.14; // 両耳の距離（顔幅）約14cm
  } else if (lEye && rEye) {
    faceWidthPx = Math.abs(lEye[0] - rEye[0]);
    actualWidthM = 0.065; // 両目の距離（瞳孔間距離）約6.5cm
  }

  // ドアップ判定用の顔幅（互換性維持のため目を優先）
  let faceWidthForCloseUp = 0;
  if (lEye && rEye) {
    faceWidthForCloseUp = Math.abs(lEye[0] - rEye[0]);
  } else if (lEar && rEar) {
    faceWidthForCloseUp = Math.abs(lEar[0] - rEar[0]);
  }

  const faceIndices = [0, 1, 2, 3, 4];
  const bodyIndices = [5, 6, 11, 12];
  const faces = faceIndices.map(i => keypoints[i]).filter(isValidKpt);
  const bodies = bodyIndices.map(i => keypoints[i]).filter(isValidKpt);

  // 両目の距離が80px以上（画面内で顔が大きく映っている）、
  // 顔は見えているが胴体（肩・腰）が全く見えない、
  // または検出されたキーポイントのバウンディングボックスが画面の大部分を占める場合はドアップとみなす
  const isCloseUp = faceWidthForCloseUp > 80 || 
                    (faces.length > 0 && bodies.length === 0) ||
                    (bboxW > IMG_W * 0.6) || 
                    (bboxH > IMG_H * 0.8);
  // ------------------------------

  // 下半身（腰、膝、足首）が少なくとも1つ見えているかを確認
  // 11: L Hip, 12: R Hip, 13: L Knee, 14: R Knee, 15: L Ankle, 16: R Ankle
  const lowerBodyIndices = [11, 12, 13, 14, 15, 16];
  const hasLowerBody = lowerBodyIndices.some(i => isValidKpt(keypoints[i]));

  // 顔の幅からカメラまでの距離を推定する（足元が見えない場合のフォールバック用）
  let estimatedDistanceM = null;
  if (faceWidthPx > 10) {
    const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;
    const tanFovY = Math.tan(((fovDeg / 2) * Math.PI) / 180);
    // D = (W_real * IMG_H) / (2 * W_px * tan(fovY / 2))
    estimatedDistanceM = (actualWidthM * IMG_H) / (2 * faceWidthPx * tanFovY);
  }

  // 【不具合修正】下半身が見えない（顔面アップ等）場合、顔のパーツ配置によって
  // バウンディングボックスが横長になり、誤って「転倒」と判定されるのを防ぐため、
  // aspectRatioを強制的に縦長(安全側)として扱う。
  if (!hasLowerBody || isCloseUp) {
    aspectRatio = Math.max(aspectRatio, 2.0);
  }

  // 【精度向上】床の座標を正確に計算するため、人物の「中心」ではなく「足元（接地点）」を基準にする。
  // 足首(15,16) -> 膝(13,14) -> 腰(11,12) -> バウンディングボックス下端 の順でフォールバック。
  const ankleL = keypoints[15];
  const ankleR = keypoints[16];
  const kneeL = keypoints[13];
  const kneeR = keypoints[14];
  const hipL = keypoints[11];
  const hipR = keypoints[12];

  let refX, refY;
  if (isCloseUp) {
    // ドアップの場合は足元が見えないため、バウンディングボックスの中心を使う
    refX = (bbox.minX + bbox.maxX) / 2;
    refY = (bbox.minY + bbox.maxY) / 2;
  } else if (isValidKpt(ankleL) && isValidKpt(ankleR)) {
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

  const useEstimatedDistance = !hasLowerBody || isCloseUp;

  return {
    avgConf,
    bbox,
    aspectRatio,
    hasLowerBody: isCloseUp ? false : hasLowerBody,
    // 足元を基準にしているため、投影先の高さオフセット(targetY)は0(床面)のままでよい
    floor: imageToFloor(refX, refY, roomConfig, 0, isCloseUp, useEstimatedDistance ? estimatedDistanceM : null),
    visibleCount: visible.length,
    keypoints,
    isCloseUp,
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
//
// 【精度向上】投影先高さオフセット(targetY)の追加
// MQTT等で受信した「人物の中心座標」をそのまま床面(Y=0)に投影すると、レイが
// 足元ではなく腰や胸の高さに向かっているため、実際の立ち位置よりも奥に投影されて
// しまう誤差がありました。targetYを指定することで、床面ではなく「人物の中心の高さ」
// の仮想平面との交点を計算し、奥行きのズレを解消します。
// -------------------------------------------------------------------
export function imageToFloor(imgX, imgY, roomConfig, targetY = 0, isCloseUp = false, estimatedDistanceM = null) {
  const cameraMount = roomConfig?.cameraMount || DEFAULT_CAMERA_MOUNT;
  const yawDeg = roomConfig?.cameraYawDeg ?? DEFAULT_YAW_DEG;
  const pitchDeg = roomConfig?.cameraPitchDeg ?? DEFAULT_PITCH_DEG;
  const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;

  // 1. 画像座標を正規化デバイス座標 (NDC: -1.0 〜 1.0) に変換
  // 画像は左上が原点・下方向が+Yのため、ndcYは向きを反転させて
  // 「画像の上側=+1、下側=-1」になるようにしている(カメラのローカル空間の
  // 上方向=+Yに合わせるため)。
  // 【不具合修正】実機で動作確認したところ、前後(奥行き)の表示は正しいが、
  // 左右が反転して表示されるとの報告があった。前後(pitch/ndcY側)は問題ない
  // ことから、原因は画像の左右(ndcX)の向きにあると判断し、ndcXの符号を
  // 反転させた(画像の右側=ndcX+1ではなく、画像の右側=ndcX-1になるようにする)。
  const ndcX = 1 - (imgX / IMG_W) * 2;
  const ndcY = 1 - (imgY / IMG_H) * 2;

  const aspect = IMG_W / IMG_H;
  const tanFov = Math.tan(((fovDeg / 2) * Math.PI) / 180);

  // 2. カメラの向き(yaw=左右, pitch=上下)から、ワールド空間での
  // 前方(forward)・右(right)・上(up)の3本の基底ベクトルを求める。
  // forward: RoomScene.jsxのpovCameraのdirX/dirY/dirZとまったく同じ式
  // (yaw=0・pitch=0のとき+Z方向を向き、yawが増えると+X方向へ、pitchが
  // 増えると下向きへ回転する)。
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const forward = {
    x: Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
  // right: 水平面内のみ(カメラは左右に傾く(ロールする)ことは無い前提)。
  // CameraMount.jsxがyaw分だけY軸回転させた箱・扇形の「右方向」と一致する。
  const right = {
    x: Math.cos(yawRad),
    y: 0,
    z: -Math.sin(yawRad),
  };
  // up = forward × right (右手系の外積)。pitchで傾いた分だけ、カメラの
  // 「上」方向も一緒に傾く(カメラのレンズが下を向くほど、上面は前方向へ傾く)。
  const up = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  // 3. 画像上のピクセル位置(NDC)に応じて、上記の基底ベクトルを合成し、
  // カメラからそのピクセルの方向へ伸びる実際のレイ(方向ベクトル)を求める
  // (前方distanceを1とした仮想フィルム面上の点への方向)。
  const rawDir = {
    x: forward.x + right.x * ndcX * aspect * tanFov + up.x * ndcY * tanFov,
    y: forward.y + right.y * ndcX * aspect * tanFov + up.y * ndcY * tanFov,
    z: forward.z + right.z * ndcX * aspect * tanFov + up.z * ndcY * tanFov,
  };
  // 【重要】rawDirは長さ1のベクトルではない(画像の端に近いピクセルほど、
  // 仮想フィルム面までの距離が長くなる分だけ長さも伸びる)。そのまま
  // 「t = -cameraMount.y / rawDir.y」で交差点を求めることはできる(tは
  // 「rawDirの何倍進んだか」を表すスカラーとして機能する)ものの、下記の
  // 投影距離クランプ処理は「実際のメートル単位の距離」を扱いたいため、
  // ここで正規化(長さ1のベクトルに)しておく。正規化後は t がそのまま
  // カメラからの実距離(メートル)になる。
  const dirLen = Math.hypot(rawDir.x, rawDir.y, rawDir.z) || 1;
  const dir = { x: rawDir.x / dirLen, y: rawDir.y / dirLen, z: rawDir.z / dirLen };

  // 4. レイと指定平面（Y=targetY）の交差判定
  // カメラの高さ(cameraMount.y)から、レイがどれくらいの距離(t、メートル)で
  // 指定の高さに到達するか計算する。
  const footprint = roomConfig?.footprint || DEFAULT_FOOTPRINT;
  const roomBounds = footprintBounds(footprint);
  const roomDiagonalM = Math.hypot(roomBounds.width, roomBounds.depth);
  const MAX_RAY_DISTANCE_M = Math.max(roomDiagonalM * 1.5, 5);

  const clampRayToFootprint = (distance) => {
    const targetX = cameraMount.x + dir.x * distance;
    const targetZ = cameraMount.z + dir.z * distance;
    if (pointInPolygon(targetX, targetZ, footprint)) {
      return { x: targetX, z: targetZ };
    }
    let lo = 0;
    let hi = distance;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const midX = cameraMount.x + dir.x * mid;
      const midZ = cameraMount.z + dir.z * mid;
      if (pointInPolygon(midX, midZ, footprint)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return { x: cameraMount.x + dir.x * lo, z: cameraMount.z + dir.z * lo };
  };

  // 指定平面(Y=targetY)への投影で求めた距離(レイがほぼ水平・上向きで交差しない
  // 場合は上限距離をそのまま採用する)。
  // 【不具合修正】足元が見えない場合やドアップの場合、参照座標(refY)が足元ではなく顔や胸になり、
  // そのレイを床面(Y=0)まで延長すると数メートル先の遠方に誤投影されてしまう。
  // そのため、顔の幅から推定した距離(estimatedDistanceM)がある場合はそれを優先し、
  // 無い場合はカメラの足元付近(0.5m)に固定する。
  let floorDistanceM;
  if (estimatedDistanceM !== null) {
    // estimatedDistanceM はカメラのローカルZ(前方)方向の距離。
    // レイの方向(dir)に沿った実際の距離に変換するには dirLen を掛ける。
    floorDistanceM = estimatedDistanceM * dirLen;
  } else if (isCloseUp || dir.y >= -1e-4) {
    floorDistanceM = 0.5;
  } else {
    floorDistanceM = Math.min(-(cameraMount.y - targetY) / dir.y, MAX_RAY_DISTANCE_M);
  }

  const distanceM = floorDistanceM;

  // 交差点(床の上の座標。実際の壁の内側に収まるようクランプ済み)
  return clampRayToFootprint(distanceM);
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