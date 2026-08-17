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
//
// 【不具合修正】「カメラの向いている位置と3Dのカメラの向いている方向を実際に
// 同じにしてほしい」「カメラから見て正確な位置に人を表示してほしい」という
// 指摘を受けて、向きの基準を修正しました。以前の実装は「Three.jsのカメラは
// -Z方向を向く」という一般的な前提でyaw/pitchの回転行列を組み立てていましたが、
// このアプリの3D表示(RoomScene.jsxのカメラの視点=povCamera、CameraMount.jsxの
// カメラアイコン・視野角の扇形)は、どちらも「yaw=0・pitch=0のとき+Z方向を向く」
// という向き定義で実装されています。この2つの向き定義が食い違っていたため、
// 検出した人物の投影方向が、実際にカメラが向いている方向(3D表示で見えている
// カメラのレンズ・扇形の向き)とズレる(角度によっては前後・左右が逆になる)
// 不具合がありました。
// 下記ではforward(前方)・right(右)・up(上)の3本の基底ベクトルを、
// RoomScene.jsxのpovCamera・CameraMount.jsxと完全に同じ式(forward.z =
// cos(yaw)*cos(pitch) が正、など)で明示的に組み立ててから、画像上のピクセル
// 位置に応じてこの基底ベクトルを合成する方式に変更し、3D表示上でカメラが
// 実際に向いている方向と、人物の投影方向を一致させています。
// -------------------------------------------------------------------
export function imageToFloor(imgX, imgY, roomConfig) {
  const cameraMount = roomConfig?.cameraMount || DEFAULT_CAMERA_MOUNT;
  const yawDeg = roomConfig?.cameraYawDeg ?? DEFAULT_YAW_DEG;
  const pitchDeg = roomConfig?.cameraPitchDeg ?? DEFAULT_PITCH_DEG;
  const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;

  // 1. 画像座標を正規化デバイス座標 (NDC: -1.0 〜 1.0) に変換
  // 画像は左上が原点・下方向が+Yのため、ndcYは向きを反転させて
  // 「画像の上側=+1、下側=-1」になるようにしている(カメラのローカル空間の
  // 上方向=+Yに合わせるため)。
  const ndcX = (imgX / IMG_W) * 2 - 1;
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
  const dir = {
    x: forward.x + right.x * ndcX * aspect * tanFov + up.x * ndcY * tanFov,
    y: forward.y + right.y * ndcX * aspect * tanFov + up.y * ndcY * tanFov,
    z: forward.z + right.z * ndcX * aspect * tanFov + up.z * ndcY * tanFov,
  };

  // 4. レイと床面（Y=0）の交差判定
  // カメラの高さ(cameraMount.y)から、レイがどれくらいの距離(t)で床に到達するか計算
  if (dir.y >= 0) {
    // レイが水平または上を向いている（床と交差しない＝空や遠くの壁を見ている）場合
    // 計算不能なため、カメラの正面遠方（仮に10m先）の座標を返す
    return {
      x: cameraMount.x + dir.x * 10,
      z: cameraMount.z + dir.z * 10,
    };
  }

  const t = -cameraMount.y / dir.y;

  // 交差点（床の上の座標）
  return {
    x: cameraMount.x + dir.x * t,
    z: cameraMount.z + dir.z * t,
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
