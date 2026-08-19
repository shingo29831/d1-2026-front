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
  // pitchDeg: 正の値ほど下向き。Three.jsのX軸回転は正の値で上を向いてしまう
  // (右手系のため)ので、見た目が「下向き」になるよう符号を反転させている。
  const pitchRad = -(pitchDeg * Math.PI) / 180;

  const frustumGeometry = useMemo(() => buildFrustumGeometry(fovDeg, aspect, rangeM), [fovDeg, aspect, rangeM]);

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

function buildFrustumGeometry(fovDeg, aspect, range) {
  // 垂直視野角から遠平面の高さと幅を計算
  const vFovRad = (Math.max(10, Math.min(170, fovDeg)) * Math.PI) / 180;
  const yMax = range * Math.tan(vFovRad / 2);
  const xMax = yMax * aspect;

  // 四角錐(Frustum)の5つの頂点
  const positions = [
    0, 0, 0,              // 0: 原点(カメラ位置)
    -xMax, yMax, range,   // 1: 左上
    xMax, yMax, range,    // 2: 右上
    xMax, -yMax, range,   // 3: 右下
    -xMax, -yMax, range,  // 4: 左下
  ];

  // 側面4面と底面(遠平面)を構成するインデックス
  const indices = [
    0, 1, 2, // 上面
    0, 2, 3, // 右面
    0, 3, 4, // 下面
    0, 4, 1, // 左面
    1, 4, 3, // 遠平面の三角形1
    1, 3, 2, // 遠平面の三角形2
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
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