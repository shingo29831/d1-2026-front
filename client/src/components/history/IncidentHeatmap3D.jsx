import React, { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import PlaceholderRoom from '../room-scene/PlaceholderRoom';
import Canvas3DErrorBoundary from '../room-scene/Canvas3DErrorBoundary';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds } from '../../roomShapes';
import { HEATMAP_CELL_M as CELL_M, computeHeatCells, heatColorForRatio as colorForRatio } from '../../incidentHeatmap';

// 「危険行為の履歴」タブの3D可視化のうち、3D棒グラフ(IncidentBarChart3D.jsx)とは
// 別の表示方式。「3Dのときも(棒グラフだけでなく)ヒートマップに切り替えられるように
// してほしい」という要望を受けて追加した。2DヒートマップのSVG版(HistoryPage.jsx側)
// と全く同じガウシアン密度計算をそのまま流用し、床面に敷いた色付きの平面として
// 3D空間上に描く(=見た目は2Dヒートマップと同じ考え方で、部屋を立体的に回転させて
// 確認できる版)。密度計算自体は見守りダッシュボードのヒートマップ表示
// (room-scene/HeatmapOverlay3D.jsx)とも共通化し、incidentHeatmap.jsに切り出した。

// 家具は3D棒グラフと同様、立体の箱ではなく床に敷いた色付きの平面(2D)として表示する
// (見た目・実装ともにIncidentBarChart3D.jsxのFlatFurnitureと同じ)。
function FlatFurniture({ item }) {
  const width = item.width || 0.6;
  const depth = item.depth || 0.5;
  return (
    <mesh
      position={[item.x, 0.008, item.z]}
      rotation={[-Math.PI / 2, 0, -THREE.MathUtils.degToRad(item.rotationDeg || 0)]}
    >
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial
        color={item.color || '#8b6b47'}
        roughness={0.9}
        transparent
        opacity={0.75}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function HeatCell({ cell }) {
  const color = colorForRatio(cell.norm);
  const opacity = Math.min(0.82, cell.norm * 0.82);
  return (
    <mesh position={[cell.x, 0.014, cell.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_M + 0.02, CELL_M + 0.02]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// incidents: HistoryPage側で絞り込み済みの履歴一覧をそのまま渡す
// (IncidentBarChart3D.jsxと同じ使い方。カテゴリ・エリア・期間・キーワードの
// 絞り込みがこの3Dヒートマップにも即反映される)。
export default function IncidentHeatmap3D({ incidents }) {
  const { footprint, height, furniture } = useRoomConfig();
  const { theme } = useTheme();
  const furnitureList = Array.isArray(furniture) ? furniture : [];

  const list = Array.isArray(incidents) ? incidents : [];
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const heatCells = useMemo(() => computeHeatCells(list, footprint, bounds), [list, footprint, bounds]);

  const camPos = useMemo(() => [
    bounds.width * 0.8 + 1.6,
    height * 2.2 + 2.6,
    bounds.depth * 0.8 + 1.6,
  ], [bounds.width, bounds.depth, height]);

  return (
    // Canvas(WebGL)内で何らかの例外が起きても画面全体が真っ白にならないよう、
    // この3D表示部分だけを局所的に受け止めるエラー境界で包む。
    <Canvas3DErrorBoundary>
      <Canvas shadows camera={{ position: camPos, fov: 45 }}>
        <color attach="background" args={[theme.sceneBg]} />
        <hemisphereLight args={[theme.sceneHemiSky, theme.sceneHemiGround, theme.sceneAmbient]} />
        <directionalLight
          position={[3, 6, 2]}
          intensity={theme.mode === 'dark' ? 1.1 : 0.9}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-3, 2, -2]} intensity={0.3} color={theme.mode === 'dark' ? '#3366ff' : '#aecdff'} />

        {/* 3D棒グラフと同じく、壁はほぼ透明にしてヒートマップ(床面)を見やすくする。 */}
        <Suspense fallback={null}>
          <PlaceholderRoom wallOpacity={0.06} furniture={[]} />
        </Suspense>

        {furnitureList.map((f) => (
          <FlatFurniture key={f.id} item={f} />
        ))}

        {heatCells.map((c, i) => (
          <HeatCell key={i} cell={c} />
        ))}

        {/* 「3D表示の下のあみあみ(網目)を消してほしい」という要望を受けてgridHelperを削除。 */}
        <OrbitControls enableDamping dampingFactor={0.1} minDistance={0.8} maxDistance={24} />
      </Canvas>
    </Canvas3DErrorBoundary>
  );
}
