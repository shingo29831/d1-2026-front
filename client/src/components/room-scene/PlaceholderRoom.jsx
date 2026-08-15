import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintEdges } from '../../roomShapes';

// Polycamの実スキャンモデルがまだ配置されていない時に表示する簡易的な部屋。
// 「部屋の設定」タブで指定した形(footprint: 長方形/L字型/自由な多角形)と高さ、
// 室内の間仕切り壁(walls、既定の間取りに合わせた固定値)、
// 「家具・エリアの設定」タブで配置した家具(箱)をそのまま使う
// (footprint/height/furnitureプロップが渡された場合はそれを優先する。
// 各設定タブ自身の保存前プレビュー用。wallsは編集UIが無いため常にコンテキストの値を使う)。
export default function PlaceholderRoom({ footprint: footprintProp, height: heightProp, furniture: furnitureProp, showInteriorWalls = true, solidWalls = false, wallOpacity: wallOpacityProp }) {
  const { footprint: ctxFootprint, height: ctxHeight, furniture: ctxFurniture, walls } = useRoomConfig();
  const { theme } = useTheme();
  const footprint = footprintProp && footprintProp.length >= 3 ? footprintProp : ctxFootprint;
  const h = heightProp != null ? heightProp : ctxHeight;
  const furniture = furnitureProp || ctxFurniture;

  const floorGeometry = useMemo(() => {
    // Shapeはローカルの(x,y)平面に定義される。床に寝かせたときに世界座標の
    // (x, 0, z)と一致するよう、yには-zを入れておく(下の-90°回転で符号が戻る)。
    const shape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
    return new THREE.ShapeGeometry(shape);
  }, [footprint]);

  const edges = useMemo(() => footprintEdges(footprint), [footprint]);

  const wallColor = theme.mode === 'dark' ? '#1f2937' : '#94a3b8';
  // 見守りダッシュボード(俯瞰3D)では、壁の向こう側にいる人物の位置も見えるよう
  // あえて壁を薄い半透明にしている(theme.sceneWallOpacity、かなり低い値)。
  // 一方「部屋の設定」などの各設定タブのプレビューでは人物は表示されないため、
  // 逆に壁が薄すぎて「家具や壁が無いように見える/すり抜けて見える」と分かりに
  // くくなってしまう。solidWalls=trueのときは、そうした設定タブ用に、はっきり
  // 壁だと分かる程度の半透明(0.94の完全不透明だと家具が壁の裏に隠れて見えず
  // 見づらいという指摘があったため下げた)で表示する。
  // wallOpacityを明示的に渡した場合はそちらを最優先する(例: 3D棒グラフでは
  // 棒が壁に隠れないよう、solidWallsより更に薄い専用の値を指定している)。
  const defaultWallOpacity = solidWalls ? 0.4 : theme.sceneWallOpacity;
  const wallOpacity = wallOpacityProp != null ? wallOpacityProp : defaultWallOpacity;

  return (
    <group>
      {/* 床 */}
      <mesh geometry={floorGeometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={theme.sceneFloor} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>

      {/* 壁(部屋の形に沿って各辺を1枚ずつ) */}
      {edges.map(([a, b], i) => (
        <Wall key={i} a={a} b={b} height={h} color={wallColor} opacity={wallOpacity} edgeColor={theme.borderSoft} />
      ))}

      {/* 室内の間仕切り壁(浴室・トイレ・キッチンなどの部屋割り。外壁と同じ半透明表示にして、
          俯瞰視点では壁越しにも人物の位置が見えるようにしている)。
          この壁は実際の自宅の間取り(自由な多角形の既定値)専用の固定座標のため、
          長方形/L字型など別の形が選ばれているときは表示しない(表示すると
          新しい部屋の外形と噛み合わず、外側にはみ出して見えてしまうため)。 */}
      {showInteriorWalls && (Array.isArray(walls) ? walls : []).map((w) => (
        <Wall
          key={w.id}
          a={{ x: w.x1, z: w.z1 }}
          b={{ x: w.x2, z: w.z2 }}
          height={Math.min(h, 2.4)}
          color={wallColor}
          opacity={wallOpacity}
          edgeColor={theme.borderSoft}
        />
      ))}

      {/* 「家具・エリアの設定」タブで配置した家具(箱、自由なサイズ・位置・回転) */}
      {(Array.isArray(furniture) ? furniture : []).map((f) => (
        <Furniture
          key={f.id}
          position={[f.x, (f.height || 0.5) / 2, f.z]}
          size={[f.width || 0.6, f.height || 0.5, f.depth || 0.5]}
          color={f.color || '#8b6b47'}
          rotationDeg={f.rotationDeg || 0}
        />
      ))}
    </group>
  );
}

function Wall({ a, b, height, color, opacity, edgeColor }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.05) return null;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  // group全体と同じyaw規則(local+Zが世界の(dx,dz)方向を向く)に合わせて回転させる
  const angle = Math.atan2(dx, dz);
  return (
    <mesh position={[midX, height / 2, midZ]} rotation={[0, angle, 0]}>
      <boxGeometry args={[0.08, height, Math.max(length, 0.01)]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
      <Edges color={edgeColor} />
    </mesh>
  );
}

function Furniture({ position, size, color, rotationDeg }) {
  return (
    <mesh position={position} rotation={[0, THREE.MathUtils.degToRad(rotationDeg || 0), 0]} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}
