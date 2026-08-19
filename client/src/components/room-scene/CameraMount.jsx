import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { CAMERA_LABEL } from '../../config';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';

// 実際に取り付けている見守りカメラの位置・向き(左右=yaw・上下=pitch)・
// 視野角(FOV)を3Dシーン上にも表示する。「俯瞰3D」でひと目でカメラの設置場所・
// 向き・見えている範囲の目安が分かるようにするための表示用オブジェクトで、
// 検出ロジックには影響しない。mount/yawDeg/pitchDeg/fovDegプロップが渡された
// 場合はそちらを優先する(「カメラ位置の設定」タブ自身の保存前プレビュー用)。
export default function CameraMount({ mount: mountProp, yawDeg: yawProp, pitchDeg: pitchProp, fovDeg: fovProp, rangeM: rangeProp, showFov = true }) {
  const {
    cameraMount: ctxMount,
    cameraYawDeg: ctxYaw,
    cameraPitchDeg: ctxPitch,
    cameraFovDeg: ctxFov,
    cameraRangeM: ctxRange,
    walls,
    furniture,
  } = useRoomConfig();
  const { theme } = useTheme();

  // 【不具合修正】この立体的な視界錐(見える範囲の目安)を描画する際、
  // 垂直方向のfovDegとアスペクト比から実際の水平方向の広がりを計算している。
  // ここで使うアスペクト比は、以前は<Canvas>の「今その瞬間に画面上に描画されて
  // いるピクセルサイズ」(useThreeのstate.size)をそのまま使っていたが、これだと
  // 「カメラ位置の設定」タブの小さいプレビュー枠と、見守りダッシュボードの
  // 画面いっぱいに広がる横長のキャンバスとで同じアスペクト比にならず、同じ
  // 視野角の設定値でも表示されるページによって広さが大きく変わって見えて
  // しまう(=「視野角がおかしい」と感じる)不具合があった。実機のカメラ映像は
  // どのページで見ても解像度が変わるわけではないため、ブラウザのウィンドウ
  // サイズやレイアウトに左右されない、実機の映像解像度(640×480、
  // poseGeometry.jsのIMG_W/IMG_Hと同じ4:3)を固定のアスペクト比として使うことで、
  // どのページで表示しても同じ視野角なら同じ広さの視界錐になるようにした。
  const CAMERA_ASPECT = 640 / 480;
  const aspect = CAMERA_ASPECT;

  const mount = mountProp || ctxMount;
  const yawDeg = yawProp != null ? yawProp : ctxYaw;
  const pitchDeg = pitchProp != null ? pitchProp : ctxPitch;
  const fovDeg = fovProp != null ? fovProp : ctxFov;
  // 「カメラの見える範囲も変更できるようにしてほしい」という要望を受け、以前は
  // 部屋のサイズから自動計算するだけだった長さを、
  // 「カメラ位置の設定」タブで自由に調整できるcameraRangeMに置き換えた。
  const rangeM = rangeProp != null ? rangeProp : ctxRange;
  const { x, y, z } = mount;
  const yawRad = (yawDeg * Math.PI) / 180;
  // pitchDeg: 正の値ほど下向き。このモデルは+Z方向を正面としているため、
  // X軸正の回転で+Zは-Y(下)を向く。したがって符号はそのまま使う。
  const pitchRad = (pitchDeg * Math.PI) / 180;

  const frustumGeometry = useMemo(
    () => buildClippedFrustumGeometry(mount, yawDeg, pitchDeg, fovDeg, aspect, rangeM, walls, furniture),
    [mount, yawDeg, pitchDeg, fovDeg, aspect, rangeM, walls, furniture]
  );

  return (
    <group position={[x, y, z]} rotation={[0, yawRad, 0]}>
      {/* カメラ筐体・レンズ・視界錐をpitch(上下角度)ぶん傾ける(取り付け位置自体は
          壁向き=yawのまま、レンズだけが仰角/俯角を持つ機種を想定した見た目)。 */}
      <group rotation={[pitchRad, 0, 0]}>
        {/* カメラ筐体(壁から突き出た小さな箱) */}
        <mesh castShadow>
          <boxGeometry args={[0.16, 0.11, 0.16]} />
          <meshStandardMaterial color={'#1e293b'} roughness={0.4} metalness={0.5} />
        </mesh>
        {/* レンズ(正面＝見ている方向を示す発光する点) */}
        <mesh position={[0, 0, 0.1]}>
          <sphereGeometry args={[0.035, 16, 16]} />
          <meshStandardMaterial color={theme.accent} emissive={theme.accent} emissiveIntensity={0.9} />
        </mesh>

        {/* 視野角(FOV)を示す立体的な視界錐(カメラの向き=pitchの影響を受ける) */}
        {showFov && (
          <mesh geometry={frustumGeometry}>
            <meshBasicMaterial color={theme.accent} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
      </group>

      <Html center distanceFactor={8} position={[0, 0.2, 0]} occlude={false}>
        <div style={{ ...styles.label, background: theme.accent }}>📷 {CAMERA_LABEL}</div>
      </Html>
    </group>
  );
}

function buildClippedFrustumGeometry(mount, yawDeg, pitchDeg, fovDeg, aspect, range, walls, furniture) {
  // 視界の遠平面をグリッド分割し、各頂点に向かってRaycastを行うことで
  // 障害物(壁・床・家具)による遮蔽を計算し、視界ボリュームを変形させる。
  const gridX = 32;
  const gridY = 32;
  const vFovRad = (Math.max(10, Math.min(170, fovDeg)) * Math.PI) / 180;
  const yMax = range * Math.tan(vFovRad / 2);
  const xMax = yMax * aspect;

  const origin = new THREE.Vector3(mount.x, mount.y, mount.z);
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  // カメラのワールド回転
  const euler = new THREE.Euler(pitchRad, yawRad, 0, 'YXZ');

  const positions = [];
  const indices = [];

  // 原点 (カメラ位置) はローカル座標で (0,0,0)
  positions.push(0, 0, 0);
  const originIndex = 0;

  // 遠平面のグリッド頂点を計算
  const gridIndices = [];
  let currentIndex = 1;
  const WALL_HEIGHT = 2.4; // 部屋の壁の一般的な高さ

  for (let gy = 0; gy <= gridY; gy++) {
    const row = [];
    const v = gy / gridY; // 0 to 1
    const py = yMax - v * 2 * yMax; // yMax to -yMax

    for (let gx = 0; gx <= gridX; gx++) {
      const u = gx / gridX; // 0 to 1
      const px = -xMax + u * 2 * xMax; // -xMax to xMax

      // 遠平面を球面(扇状)ではなく平面(四角錐)にするため、正規化前のベクトルを保持
      const localTarget = new THREE.Vector3(px, py, range);
      const localDirLen = localTarget.length();
      const localDirNorm = localTarget.clone().divideScalar(localDirLen);
      const worldDir = localDirNorm.clone().applyEuler(euler);

      // レイの最大長さを range ではなく、Z=range 平面までの直線距離とする
      let minDist = localDirLen;

      // 1. 床 (y = 0)
      if (worldDir.y < 0) {
        const t = -origin.y / worldDir.y;
        if (t > 0 && t < minDist) minDist = t;
      }

      // 2. 天井 (y = WALL_HEIGHT)
      if (worldDir.y > 0) {
        const t = (WALL_HEIGHT - origin.y) / worldDir.y;
        if (t > 0 && t < minDist) minDist = t;
      }

      // 3. 壁
      const len2D = Math.hypot(worldDir.x, worldDir.z);
      if (len2D > 1e-6 && walls && walls.length > 1) {
        for (let i = 0; i < walls.length; i++) {
          const A = walls[i];
          const B = walls[(i + 1) % walls.length];

          const v1x = origin.x - A.x;
          const v1z = origin.z - A.z;
          const v2x = B.x - A.x;
          const v2z = B.z - A.z;
          const v3x = -worldDir.x;
          const v3z = -worldDir.z;

          const cross = v2x * v3z - v2z * v3x;
          if (Math.abs(cross) > 1e-6) {
            const t1 = (v1x * v3z - v1z * v3x) / cross;
            const t2 = (v1x * v2z - v1z * v2x) / cross;
            if (t1 >= 0 && t1 <= 1 && t2 > 0) {
              const t3D = t2 / len2D;
              if (t3D < minDist) {
                const hitY = origin.y + t3D * worldDir.y;
                if (hitY >= 0 && hitY <= WALL_HEIGHT) {
                  minDist = t3D;
                }
              }
            }
          }
        }
      }

      // 4. 家具 (OBB)
      if (furniture && furniture.length > 0) {
        for (const f of furniture) {
          const t = rayIntersectOBB(origin, worldDir, f);
          if (t > 0 && t < minDist) {
            minDist = t;
          }
        }
      }

      // ローカル座標での最終位置
      const finalLocalPos = localDirNorm.multiplyScalar(minDist);
      positions.push(finalLocalPos.x, finalLocalPos.y, finalLocalPos.z);
      row.push(currentIndex++);
    }
    gridIndices.push(row);
  }

  // インデックスの生成
  // 遠平面のメッシュ
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const i00 = gridIndices[gy][gx];
      const i10 = gridIndices[gy][gx + 1];
      const i01 = gridIndices[gy + 1][gx];
      const i11 = gridIndices[gy + 1][gx + 1];

      indices.push(i00, i01, i10);
      indices.push(i10, i01, i11);
    }
  }

  // 側面のメッシュ (カメラ原点と遠平面の境界を結ぶ)
  for (let gx = 0; gx < gridX; gx++) {
    indices.push(originIndex, gridIndices[0][gx + 1], gridIndices[0][gx]); // 上面
    indices.push(originIndex, gridIndices[gridY][gx], gridIndices[gridY][gx + 1]); // 下面
  }
  for (let gy = 0; gy < gridY; gy++) {
    indices.push(originIndex, gridIndices[gy][0], gridIndices[gy + 1][0]); // 左面
    indices.push(originIndex, gridIndices[gy + 1][gridX], gridIndices[gy][gridX]); // 右面
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function rayIntersectOBB(origin, dir, f) {
  const cx = f.x;
  const cy = f.height / 2;
  const cz = f.z;

  const dx = origin.x - cx;
  const dy = origin.y - cy;
  const dz = origin.z - cz;

  const rad = (f.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // ワールドからローカルへの変換 (逆回転)
  const localOriginX = dx * cos - dz * sin;
  const localOriginY = dy;
  const localOriginZ = dx * sin + dz * cos;

  const localDirX = dir.x * cos - dir.z * sin;
  const localDirY = dir.y;
  const localDirZ = dir.x * sin + dir.z * cos;

  const hx = f.width / 2;
  const hy = f.height / 2;
  const hz = f.depth / 2;

  let tMin = -Infinity;
  let tMax = Infinity;

  const checkSlab = (p, d, h) => {
    if (Math.abs(d) < 1e-6) {
      if (p < -h || p > h) return false;
    } else {
      let t1 = (-h - p) / d;
      let t2 = (h - p) / d;
      if (t1 > t2) {
        const temp = t1;
        t1 = t2;
        t2 = temp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
    return true;
  };

  if (!checkSlab(localOriginX, localDirX, hx)) return -1;
  if (!checkSlab(localOriginY, localDirY, hy)) return -1;
  if (!checkSlab(localOriginZ, localDirZ, hz)) return -1;

  // カメラ(原点)が家具の内部にめり込んでいる場合は、その家具によるクリッピングを無視する
  // (家具の上や壁際にカメラを配置した際、視界が家具の箱の形に切り取られてしまうのを防ぐため)
  if (tMax < 0 || tMin < 0) return -1;
  return tMin;
}

const styles = {
  label: {
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    color: '#0f172a',
    border: '1px solid rgba(255,255,255,0.5)',
  },
};