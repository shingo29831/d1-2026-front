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
export default function CameraMount({ mount: mountProp, yawDeg: yawProp, pitchDeg: pitchProp, fovDeg: fovProp, showFov = true }) {
  const {
    cameraMount: ctxMount,
    cameraYawDeg: ctxYaw,
    cameraPitchDeg: ctxPitch,
    cameraFovDeg: ctxFov,
    roomSize,
  } = useRoomConfig();
  const { theme } = useTheme();

  const mount = mountProp || ctxMount;
  const yawDeg = yawProp != null ? yawProp : ctxYaw;
  const pitchDeg = pitchProp != null ? pitchProp : ctxPitch;
  const fovDeg = fovProp != null ? fovProp : ctxFov;
  const { x, y, z } = mount;
  const yawRad = (yawDeg * Math.PI) / 180;
  // pitchDeg: 正の値ほど下向き。Three.jsのX軸回転は正の値で上を向いてしまう
  // (右手系のため)ので、見た目が「下向き」になるよう符号を反転させている。
  const pitchRad = -(pitchDeg * Math.PI) / 180;

  const visualRange = Math.min(Math.max(roomSize.width, roomSize.depth) * 0.9, 6);
  const wedgeGeometry = useMemo(() => buildWedgeGeometry(fovDeg, visualRange), [fovDeg, visualRange]);

  return (
    <group position={[x, y, z]} rotation={[0, yawRad, 0]}>
      {/* カメラ筐体・レンズだけをpitch(上下角度)ぶん傾ける(取り付け位置自体は
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
      </group>

      {/* 視野角(FOV)を示す床面の扇形(真上から見た水平方向の目安のため、
          pitchの影響は受けない) */}
      {showFov && (
        <mesh geometry={wedgeGeometry} position={[0, 0.02 - y, 0]}>
          <meshBasicMaterial color={theme.accent} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      <Html center distanceFactor={8} position={[0, 0.2, 0]} occlude={false}>
        <div style={{ ...styles.label, background: theme.accent }}>📷 {CAMERA_LABEL}</div>
      </Html>
    </group>
  );
}

function buildWedgeGeometry(fovDeg, range) {
  const segments = 24;
  const halfRad = (Math.max(10, Math.min(170, fovDeg)) * Math.PI) / 360;
  const positions = [0, 0, 0];
  for (let i = 0; i <= segments; i++) {
    const t = -halfRad + (2 * halfRad * i) / segments;
    positions.push(range * Math.sin(t), 0, range * Math.cos(t));
  }
  const index = [];
  for (let i = 1; i <= segments; i++) index.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
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
