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

function isValidKpt(k) {
  return Array.isArray(k) && k.length >= 3 && k[2] > CONF_THRESHOLD;
}

/**
 * 1人分の生キーポイント配列から、扱いやすい特徴量にまとめる。
 * @param {Array} keypoints - 17個の[x,y,conf]配列
 * @param {{footprint:Array<{x:number,z:number}>, cameraMount:{x:number,y:number,z:number}, cameraYawDeg:number, cameraResolution:{width:number,height:number}}} [roomConfig]
 *   「部屋の設定」「カメラ位置の設定」タブでユーザーが設定した現在の部屋の形/カメラ設置位置・向き・解像度。
 *   省略時はconfig.jsの既定値を使う。
 */
export function analyzePerson(keypoints, roomConfig, previousState = null) {
  if (!Array.isArray(keypoints) || keypoints.length === 0) return null;

  const visible = keypoints.filter(isValidKpt);
  if (visible.length === 0) return null;

  const imgW = roomConfig?.cameraResolution?.width ?? 640;
  const imgH = roomConfig?.cameraResolution?.height ?? 480;

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
  const lShoulder = isValidKpt(keypoints[5]) ? keypoints[5] : null;
  const rShoulder = isValidKpt(keypoints[6]) ? keypoints[6] : null;
  const lHip = isValidKpt(keypoints[11]) ? keypoints[11] : null;
  const rHip = isValidKpt(keypoints[12]) ? keypoints[12] : null;

  const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;
  const tanFovY = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const estimates = [];

  // --- 至近距離（ドアップ）判定 ---
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

  const isCloseUp = faceWidthForCloseUp > 80 || 
                    (faces.length > 0 && bodies.length === 0) ||
                    (bboxW > imgW * 0.6) || 
                    (bboxH > imgH * 0.8);

  // --- 体の向き（横向き）による見かけの幅の圧縮補正 ---
  // 鼻が両肩の中央にあれば正面、どちらかに寄っていれば横を向いていると判定する
  let horizontalCompression = 1.0;
  const nose = isValidKpt(keypoints[0]) ? keypoints[0] : null;
  
  if (nose && lShoulder && rShoulder) {
    const shoulderWidthPx = Math.abs(lShoulder[0] - rShoulder[0]);
    const midShoulderX = (lShoulder[0] + rShoulder[0]) / 2;
    // 鼻と肩の中点のズレ。最大で肩幅の半分(0.5)までズレる
    const offsetRatio = Math.abs(nose[0] - midShoulderX) / (shoulderWidthPx / 2 || 1);
    // ズレの割合をサイン波(sinθ)とみなし、コサイン(cosθ)で圧縮率を求める
    // 完全に真横を向いている(cosθ=0)と無限大になるため、最小0.4(約66度)でクリップする
    const sinTheta = Math.min(offsetRatio, 1.0);
    horizontalCompression = Math.max(Math.sqrt(1 - sinTheta * sinTheta), 0.4);
  }

  // --- 動的キャリブレーション（学習済みサイズ）の読み込み ---
  // 過去のフレームで足元が見えていた時に逆算して学習した個人サイズがあればそれを使い、
  // なければ一般的な成人の固定値を使う。
  const learnedShoulderW = previousState?.learnedShoulderW ?? 0.38;
  const learnedHipW = previousState?.learnedHipW ?? 0.30;
  const learnedFaceW = previousState?.learnedFaceW ?? 0.14;
  const learnedEyeW = previousState?.learnedEyeW ?? 0.065;
  const learnedHeight = previousState?.learnedHeight ?? 1.6;

  // 1. 水平幅からの推定（横向き補正を適用）
  // 画面端で見切れている部位は、キーポイントが実際の幅より内側に寄って検出され、
  // 距離が遠く誤推定される原因になるため除外する。
  const edgeMargin = 15;
  const isInside = (kpt) => kpt && kpt[0] > edgeMargin && kpt[0] < imgW - edgeMargin && kpt[1] > edgeMargin && kpt[1] < imgH - edgeMargin;

  if (lShoulder && rShoulder && isInside(lShoulder) && isInside(rShoulder)) {
    const px = Math.abs(lShoulder[0] - rShoulder[0]) / horizontalCompression;
    if (px > 10) estimates.push((learnedShoulderW * imgH) / (2 * px * tanFovY));
  }
  if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
    const px = Math.abs(lHip[0] - rHip[0]) / horizontalCompression;
    if (px > 10) estimates.push((learnedHipW * imgH) / (2 * px * tanFovY));
  }
  if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
    const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
    if (px > 10) estimates.push((learnedFaceW * imgH) / (2 * px * tanFovY));
  }
  if (lEye && rEye && isInside(lEye) && isInside(rEye)) {
    const px = Math.abs(lEye[0] - rEye[0]) / horizontalCompression;
    if (px > 10) estimates.push((learnedEyeW * imgH) / (2 * px * tanFovY));
  }

  // 2. 垂直方向（見えている部位の割合）からの推定
  // 画面下端で見切れている場合（Y=480付近）はピクセル高さが圧縮されるため除外
  // また、ドアップ状態（isCloseUp）や肩が見えていない状態では、顔のわずかな高さのブレが
  // 全身の高さ推定に大きく影響し、距離が遠くへ飛んでしまう原因になるため除外する。
  let estimatedFullHeightPx = null;
  let verticalCompression = 1.0;
  if (bbox.maxY < imgH - 10 && !isCloseUp && (lShoulder || rShoulder)) {
    let visibleRatio = 1.0;
    if (isValidKpt(keypoints[15]) || isValidKpt(keypoints[16])) visibleRatio = 1.0;
    else if (isValidKpt(keypoints[13]) || isValidKpt(keypoints[14])) visibleRatio = 0.75;
    else if (isValidKpt(keypoints[11]) || isValidKpt(keypoints[12])) visibleRatio = 0.5;
    else visibleRatio = 0.25;

    estimatedFullHeightPx = bboxH / visibleRatio;
    
    // カメラのピッチ角（上下の傾き）による見かけの高さの圧縮を補正
    // カメラが下（俯瞰）や上（仰瞰）を向いているほど、直立した人物は画面上で短く映る
    const pitchDeg = roomConfig?.cameraPitchDeg ?? DEFAULT_PITCH_DEG;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    verticalCompression = Math.max(Math.cos(pitchRad), 0.3); // 極端な角度でも最低30%は確保
    const apparentHeightM = learnedHeight * verticalCompression;

    const verticalEstimate = (apparentHeightM * imgH) / (2 * estimatedFullHeightPx * tanFovY);
    estimates.push(verticalEstimate);
  }

  let estimatedDistanceM = null;
  if (estimates.length > 0) {
    // キーポイントは実際の幅より内側に出やすいため、最も遠い推定値を採用する
    // さらに、WebカメラのFOVが対角視野角で入力されているケースを考慮し 1.2 倍の補正をかける
    estimatedDistanceM = Math.max(...estimates) * 1.2;
  } else if (isCloseUp) {
    // ドアップ状態で耳や目が見切れて estimates が空になった場合でも、
    // 画面の大部分を占めている（至近距離である）ことは確実なため、
    // バウンディングボックスの幅から強制的に至近距離を算出するセーフティネット。
    const fallbackEstimate = (learnedFaceW * imgH) / (2 * bboxW * tanFovY);
    estimatedDistanceM = fallbackEstimate * 1.2;
  }

  // ------------------------------

  // 下半身（腰、膝、足首）が少なくとも1つ見えているかを確認
  // 11: L Hip, 12: R Hip, 13: L Knee, 14: R Knee, 15: L Ankle, 16: R Ankle
  const lowerBodyIndices = [11, 12, 13, 14, 15, 16];
  const hasLowerBody = lowerBodyIndices.some(i => isValidKpt(keypoints[i]));

  // 【不具合修正】下半身が見えない（顔面アップ等）場合、顔のパーツ配置によって
  // バウンディングボックスが横長になり、誤って「転倒」と判定されるのを防ぐため、
  // aspectRatioを強制的に縦長(安全側)として扱う。
  if (!hasLowerBody || isCloseUp) {
    aspectRatio = Math.max(aspectRatio, 2.0);
  }

  // 【精度向上】床の座標を正確に計算するため、人物の「最も下にある有効な部位」を基準にする。
  // その部位の標準的な高さを targetY としてレイキャストを行うことで、
  // 「どの高さのカメラから見て、画面のどの位置にその部位が映るか」から距離を逆算する。
  const ankleL = keypoints[15];
  const ankleR = keypoints[16];
  const kneeL = keypoints[13];
  const kneeR = keypoints[14];
  const hipL = keypoints[11];
  const hipR = keypoints[12];

  let refX, refY, targetY;

  // 下から順に、有効な部位を探す
  // AIの確信度(Confidence: p[2])を重みとして加重平均することで、
  // 家具などで隠れかけて不正確になったキーポイントに引っ張られるブレを防ぐ。
  const getWeightedCenter = (pts) => {
    const totalWeight = pts.reduce((sum, p) => sum + p[2], 0);
    return {
      x: pts.reduce((sum, p) => sum + p[0] * p[2], 0) / totalWeight,
      y: pts.reduce((sum, p) => sum + p[1] * p[2], 0) / totalWeight,
    };
  };

  if (isValidKpt(ankleL) || isValidKpt(ankleR)) {
    const pts = [ankleL, ankleR].filter(isValidKpt);
    const center = getWeightedCenter(pts);
    refX = center.x; refY = center.y;
    targetY = 0.1; // 足首の高さ(約0.1m)
  } else if (isValidKpt(kneeL) || isValidKpt(kneeR)) {
    const pts = [kneeL, kneeR].filter(isValidKpt);
    const center = getWeightedCenter(pts);
    refX = center.x; refY = center.y;
    targetY = 0.5; // 膝の高さ(約0.5m)
  } else if (isValidKpt(hipL) || isValidKpt(hipR)) {
    const pts = [hipL, hipR].filter(isValidKpt);
    const center = getWeightedCenter(pts);
    refX = center.x; refY = center.y;
    targetY = 1.0; // 腰の高さ(約1.0m)
  } else if (isValidKpt(lShoulder) || isValidKpt(rShoulder)) {
    const pts = [lShoulder, rShoulder].filter(isValidKpt);
    const center = getWeightedCenter(pts);
    refX = center.x; refY = center.y;
    targetY = 1.4; // 肩の高さ(約1.4m)
  } else if (isCloseUp) {
    // 顔しか見えない場合、目の中心を使う
    const pts = [lEye, rEye, lEar, rEar, keypoints[0]].filter(isValidKpt);
    if (pts.length > 0) {
      const center = getWeightedCenter(pts);
      refX = center.x; refY = center.y;
    } else {
      refX = (bbox.minX + bbox.maxX) / 2;
      refY = (bbox.minY + bbox.maxY) / 2;
    }
    targetY = 1.5; // 顔の高さ(約1.5m)
  } else {
    refX = (bbox.minX + bbox.maxX) / 2;
    refY = bbox.maxY;
    targetY = 0.0;
  }

  const rawFloor = imageToFloor(refX, refY, roomConfig, targetY, isCloseUp, estimatedDistanceM);

  // --- 動的キャリブレーション（個人サイズの学習） ---
  let nextState = { ...previousState };
  const alpha = 0.05; // 学習率（急激な変化を防ぐためゆっくり学習させる）

  // 1. 絶対スケールの学習（足元が綺麗に見えていて、レイキャストが正確な場合）
  if (rawFloor.isAccurateRaycast && rawFloor.distanceM > 0.5) {
    // 距離 D から実際のサイズ W_real を逆算: W_real = (2 * W_px * tanFovY * D) / (imgH * 1.2)
    // ※推定時に 1.2 倍の補正をかけているため、逆算時も 1.2 で割ってスケールを合わせる
    const calcReal = (px) => (2 * px * tanFovY * rawFloor.distanceM) / (imgH * 1.2);

    if (lShoulder && rShoulder && isInside(lShoulder) && isInside(rShoulder)) {
      const px = Math.abs(lShoulder[0] - rShoulder[0]) / horizontalCompression;
      if (px > 10) {
        const w = calcReal(px);
        if (w > 0.2 && w < 0.6) nextState.learnedShoulderW = learnedShoulderW * (1 - alpha) + w * alpha;
      }
    }
    if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
      const px = Math.abs(lHip[0] - rHip[0]) / horizontalCompression;
      if (px > 10) {
        const w = calcReal(px);
        if (w > 0.15 && w < 0.5) nextState.learnedHipW = learnedHipW * (1 - alpha) + w * alpha;
      }
    }
    if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
      const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
      if (px > 10) {
        const w = calcReal(px);
        if (w > 0.08 && w < 0.25) nextState.learnedFaceW = learnedFaceW * (1 - alpha) + w * alpha;
      }
    }
    if (lEye && rEye && isInside(lEye) && isInside(rEye)) {
      const px = Math.abs(lEye[0] - rEye[0]) / horizontalCompression;
      if (px > 10) {
        const w = calcReal(px);
        if (w > 0.04 && w < 0.12) nextState.learnedEyeW = learnedEyeW * (1 - alpha) + w * alpha;
      }
    }
    if (estimatedFullHeightPx) {
      const h = calcReal(estimatedFullHeightPx) / verticalCompression;
      if (h > 0.8 && h < 2.2) nextState.learnedHeight = learnedHeight * (1 - alpha) + h * alpha;
    }
  } 
  // 2. 相対スケールの学習（足元が見えないが、複数のパーツが見えている場合）
  // 見えているパーツ間でサイズを同期させ、一部しか映らなくなった時の距離のジャンプを防ぐ
  else {
    let referenceDistance = null;
    
    // 最も安定している肩幅を基準にする
    if (lShoulder && rShoulder && isInside(lShoulder) && isInside(rShoulder)) {
      const px = Math.abs(lShoulder[0] - rShoulder[0]) / horizontalCompression;
      if (px > 10) referenceDistance = (learnedShoulderW * imgH) / (2 * px * tanFovY);
    } 
    // 肩が見えなければ腰幅を基準にする
    else if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
      const px = Math.abs(lHip[0] - rHip[0]) / horizontalCompression;
      if (px > 10) referenceDistance = (learnedHipW * imgH) / (2 * px * tanFovY);
    }
    // 腰も見えなければ顔幅を基準にする
    else if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
      const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
      if (px > 10) referenceDistance = (learnedFaceW * imgH) / (2 * px * tanFovY);
    }

    if (referenceDistance !== null) {
      // 基準距離から他のパーツの実際のサイズを逆算（ここでは1.2倍補正は不要）
      const calcReal = (px) => (2 * px * tanFovY * referenceDistance) / imgH;

      // 肩幅が基準の場合、腰と顔と目を学習
      if (lShoulder && rShoulder && isInside(lShoulder) && isInside(rShoulder)) {
        if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
          const px = Math.abs(lHip[0] - rHip[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.15 && w < 0.5) nextState.learnedHipW = learnedHipW * (1 - alpha) + w * alpha;
          }
        }
        if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
          const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.08 && w < 0.25) nextState.learnedFaceW = learnedFaceW * (1 - alpha) + w * alpha;
          }
        }
        if (lEye && rEye && isInside(lEye) && isInside(rEye)) {
          const px = Math.abs(lEye[0] - rEye[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.04 && w < 0.12) nextState.learnedEyeW = learnedEyeW * (1 - alpha) + w * alpha;
          }
        }
      }
      // 腰幅が基準の場合、顔と目を学習
      else if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
        if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
          const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.08 && w < 0.25) nextState.learnedFaceW = learnedFaceW * (1 - alpha) + w * alpha;
          }
        }
        if (lEye && rEye && isInside(lEye) && isInside(rEye)) {
          const px = Math.abs(lEye[0] - rEye[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.04 && w < 0.12) nextState.learnedEyeW = learnedEyeW * (1 - alpha) + w * alpha;
          }
        }
      }
      // 顔幅が基準の場合、目を学習
      else if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
        if (lEye && rEye && isInside(lEye) && isInside(rEye)) {
          const px = Math.abs(lEye[0] - rEye[0]) / horizontalCompression;
          if (px > 10) {
            const w = calcReal(px);
            if (w > 0.04 && w < 0.12) nextState.learnedEyeW = learnedEyeW * (1 - alpha) + w * alpha;
          }
        }
      }

      if (estimatedFullHeightPx) {
        const h = calcReal(estimatedFullHeightPx) / verticalCompression;
        if (h > 0.8 && h < 2.2) nextState.learnedHeight = learnedHeight * (1 - alpha) + h * alpha;
      }
    }
  }

  // --- 最大ピクセルサイズの記録（大きく表示された時の基準化用） ---
  if (lEar && rEar && isInside(lEar) && isInside(rEar)) {
    const px = Math.abs(lEar[0] - rEar[0]) / horizontalCompression;
    nextState.maxFacePx = Math.max(nextState.maxFacePx || 0, px);
  }
  if (lShoulder && rShoulder && isInside(lShoulder) && isInside(rShoulder)) {
    const px = Math.abs(lShoulder[0] - rShoulder[0]) / horizontalCompression;
    nextState.maxShoulderPx = Math.max(nextState.maxShoulderPx || 0, px);
  }
  if (lHip && rHip && isInside(lHip) && isInside(rHip)) {
    const px = Math.abs(lHip[0] - rHip[0]) / horizontalCompression;
    nextState.maxHipPx = Math.max(nextState.maxHipPx || 0, px);
  }

  // --- 時間的な平滑化（α-βフィルタ：速度を考慮した予測型トラッキング） ---
  // 単純な移動平均では歩行時に「実際の立ち位置より後ろに遅れる」現象が発生するため、
  // 移動速度(vx, vz)も学習し、次フレームの位置を予測することで遅れをなくす。
  let smoothedFloor = { x: rawFloor.x, z: rawFloor.z };
  let nextVx = previousState?.vx ?? 0;
  let nextVz = previousState?.vz ?? 0;
  const now = Date.now();

  if (previousState?.floor) {
    const prevFloor = previousState.floor;
    // 評価間隔を動的に計算（1秒おきのデータ送信に対応）
    let dt = 0.3;
    if (previousState.time) {
      dt = (now - previousState.time) / 1000;
      if (dt <= 0 || dt > 3.0) dt = 0.3; // 異常な値の場合はデフォルトに戻す
    }

    // 1. 予測ステップ（現在の速度でそのまま進んだと仮定した位置）
    const predictedX = prevFloor.x + nextVx * dt;
    const predictedZ = prevFloor.z + nextVz * dt;

    // 2. 観測との差分（イノベーション）
    const ex = rawFloor.x - predictedX;
    const ez = rawFloor.z - predictedZ;
    const dist = Math.sqrt(ex * ex + ez * ez);

    // 1秒あたり2.0m以上の移動をワープとみなし、平滑化をリセットする（追従を優先）
    const warpThreshold = Math.max(1.5, 2.0 * dt);
    if (dist < warpThreshold) {
      const alpha = 0.4; // 位置の補正ゲイン（高いほど観測値に追従）
      const beta = 0.2;  // 速度の補正ゲイン（高いほど速度変化に敏感）

      smoothedFloor = {
        x: predictedX + alpha * ex,
        z: predictedZ + alpha * ez,
      };
      nextVx = nextVx + (beta / dt) * ex;
      nextVz = nextVz + (beta / dt) * ez;
      
      // 速度の減衰（摩擦）を入れて、立ち止まった時に予測が暴走するのを防ぐ
      nextVx *= 0.8;
      nextVz *= 0.8;
    } else {
      nextVx = 0;
      nextVz = 0;
    }
  }
  nextState.floor = smoothedFloor;
  nextState.vx = nextVx;
  nextState.vz = nextVz;
  nextState.time = now;

  return {
    avgConf,
    bbox,
    aspectRatio,
    hasLowerBody: isCloseUp ? false : hasLowerBody,
    floor: smoothedFloor,
    state: nextState,
    visibleCount: visible.length,
    keypoints,
    isCloseUp,
  };
}

// -------------------------------------------------------------------
// 画像座標(640x480等) → 部屋のフロア座標(メートル, 部屋中心付近が原点) への変換。
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
export function getRayDirection(imgX, imgY, roomConfig) {
  const imgW = roomConfig?.cameraResolution?.width ?? 640;
  const imgH = roomConfig?.cameraResolution?.height ?? 480;

  const yawDeg = roomConfig?.cameraYawDeg ?? DEFAULT_YAW_DEG;
  const pitchDeg = roomConfig?.cameraPitchDeg ?? DEFAULT_PITCH_DEG;
  const fovDeg = roomConfig?.cameraFovDeg ?? DEFAULT_FOV_DEG;

  const ndcX = 1 - (imgX / imgW) * 2;
  const ndcY = 1 - (imgY / imgH) * 2;
  const aspect = imgW / imgH;
  const tanFov = Math.tan(((fovDeg / 2) * Math.PI) / 180);

  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const forward = {
    x: Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
  const right = {
    x: Math.cos(yawRad),
    y: 0,
    z: -Math.sin(yawRad),
  };
  const up = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  const rawDir = {
    x: forward.x + right.x * ndcX * aspect * tanFov + up.x * ndcY * tanFov,
    y: forward.y + right.y * ndcX * aspect * tanFov + up.y * ndcY * tanFov,
    z: forward.z + right.z * ndcX * aspect * tanFov + up.z * ndcY * tanFov,
  };
  const dirLen = Math.hypot(rawDir.x, rawDir.y, rawDir.z) || 1;
  return { x: rawDir.x / dirLen, y: rawDir.y / dirLen, z: rawDir.z / dirLen, dirLen };
}

export function imageToFloor(imgX, imgY, roomConfig, targetY = 0, isCloseUp = false, estimatedDistanceM = null) {
  const cameraMount = roomConfig?.cameraMount || DEFAULT_CAMERA_MOUNT;
  const ray = getRayDirection(imgX, imgY, roomConfig);
  const dir = ray;
  const dirLen = ray.dirLen;

  // カメラの高さとターゲットの高さが近すぎる場合（例: カメラ高0.1mで足首0.1mを狙う）、
  // 距離が0になってしまうのを防ぐため、ターゲットを床面(0m)にフォールバックする
  let actualTargetY = targetY;
  if (Math.abs(cameraMount.y - actualTargetY) < 0.1) {
    actualTargetY = 0;
  }

  // 4. レイと指定平面（Y=actualTargetY）の交差判定
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

  let floorDistanceM;
  let isAccurateRaycast = false;

  // カメラから対象ピクセルへ向かうレイが、水平よりも下を向いているか（俯瞰）
  // dir.y が負なら下向き。-0.05 は約3度以上下を向いていることを意味する
  const isLookingDown = dir.y < -0.05;

  if (actualTargetY <= 0.5 && isLookingDown) {
    // 足首(0.1)や膝(0.5)が見えていて、かつレイがしっかり下を向いている場合は
    // 床面との交差角度が十分に取れるため、レイキャストが最も正確になる
    const heightDiff = cameraMount.y - actualTargetY;
    if (heightDiff * dir.y < 0) {
      floorDistanceM = -heightDiff / dir.y;
      isAccurateRaycast = true; // キャリブレーションの学習に使える信頼できる値
    } else {
      floorDistanceM = estimatedDistanceM !== null ? estimatedDistanceM * dirLen : 0.5;
    }
  } else {
    // カメラが水平〜上向きの場合、レイキャストは無限遠に飛んだり空を向いたりして破綻する。
    // また、腰(1.0)や肩(1.4)しか見えていない場合も、姿勢による高さのブレが大きいため、
    // どちらの場合もピクセル幅・高さからの推定距離を最優先する。
    if (estimatedDistanceM !== null) {
      floorDistanceM = estimatedDistanceM * dirLen;
    } else {
      const heightDiff = cameraMount.y - actualTargetY;
      // カメラの高さと対象(actualTargetY)の高さが近い場合、レイが水平に近くなる(dir.yが0に近い)と
      // 距離が無限遠に飛んでしまう(ゼロ除算に近い状態)のを防ぐため、角度が浅すぎる場合は除外する。
      if (Math.abs(dir.y) > 0.05 && (heightDiff * dir.y < 0)) {
        floorDistanceM = -heightDiff / dir.y;
      } else {
        floorDistanceM = 0.5;
      }
    }
  }

  const distanceM = Math.min(floorDistanceM, MAX_RAY_DISTANCE_M);

  // 交差点(床の上の座標。実際の壁の内側に収まるようクランプ済み)
  const pos = clampRayToFootprint(distanceM);
  return { x: pos.x, z: pos.z, distanceM, isAccurateRaycast };
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