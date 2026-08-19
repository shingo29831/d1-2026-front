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

// 「危険行為の履歴」タブの3D可視化。2DヒートマップのSVG版(HistoryPage.jsx側)
// と全く同じガウシアン密度計算をそのまま流用し、床面に敷いた色付きの平面として
// 3D空間上に描く(=見た目は2Dヒートマップと同じ考え方で、部屋を立体的に回転させて
// 確認できる版)。密度計算自体は見守りダッシュボードのヒートマップ表示
// (room-scene/HeatmapOverlay3D.jsx)とも共通化し、incidentHeatmap.jsに切り出した。
// 【2026-08-19further変更】以前は3D棒グラフ(IncidentBarChart3D.jsx)との切り替えが
// あったが、「棒グラフは削除してヒートマップのみでよい」というご要望を受け、
// HistoryPage.jsx側からはこのヒートマップだけを使うようにした。
//
// 【重要・不具合修正】「危険行為履歴の3Dヒートマップが表示されない(見守り
// ダッシュボードのヒートマップは正常)」という報告への対応。カメラ位置
// (camPos)を部屋のサイズ(bounds.width/depth/height)から直接計算していたが、
// 万一これらの値が不正(NaN/Infinity。部屋の設定データが特殊な場合など)
// だと、カメラの位置・投影行列がNaNになってしまう。これはReactのレンダー
// サイクルの外側(react-three-fiberの毎フレーム描画ループ)で起きるため、
// Reactのエラー境界(Canvas3DErrorBoundary、下記)では捕捉できない種類の
// 失敗になりうる。その場合「エラーメッセージも出ないまま何も表示されない」
// という、報告と一致する症状になる。そのためcamPos・家具の位置ともに
// Number.isFinite()で検証し、不正な値は安全な既定値へフォールバックする。
function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// 家具は立体の箱ではなく床に敷いた色付きの平面(2D)として表示する。
function FlatFurniture({ item }) {
  const width = item.width || 0.6;
  const depth = item.depth || 0.5;
  const x = isFiniteNum(item.x) ? item.x : 0;
  const z = isFiniteNum(item.z) ? item.z : 0;
  return (
    <mesh
      position={[x, 0.008, z]}
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

// incidents: HistoryPage側で絞り込み済みの履歴一覧をそのまま渡す。カテゴリ・
// エリア・期間・キーワードの絞り込みがこの3Dヒートマップにも即反映される。
// resetKey: 絞り込み条件が変わって再描画されるたびに値を変えて渡すことで、
// 万一エラー境界がエラー状態のまま固まっていても再挑戦できるようにする
// (Canvas3DErrorBoundary.jsx参照)。
export default function IncidentHeatmap3D({ incidents, resetKey }) {
  const { footprint, height, furniture } = useRoomConfig();
  const { theme } = useTheme();
  const furnitureList = Array.isArray(furniture) ? furniture : [];

  const list = Array.isArray(incidents) ? incidents : [];
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const heatCells = useMemo(() => computeHeatCells(list, footprint, bounds), [list, footprint, bounds]);

  // 【不具合修正】bounds.width/depth・heightのいずれかが不正(NaN/Infinity)
  // でも安全な既定値にフォールバックし、かつOrbitControlsのmaxDistance(24)を
  // 超えないよう各成分を上限13(3成分ともこの値だと合成距離は約22.5で24未満)
  // にクランプしておく。
  const camPos = useMemo(() => {
    const w = isFiniteNum(bounds.width) ? bounds.width : 4;
    const d = isFiniteNum(bounds.depth) ? bounds.depth : 4;
    const h = isFiniteNum(height) ? height : 2.4;
    const clamp = (v) => Math.min(Math.max(v, 1.6), 13);
    return [
      clamp(w * 0.8 + 1.6),
      clamp(h * 2.2 + 2.6),
      clamp(d * 0.8 + 1.6),
    ];
  }, [bounds.width, bounds.depth, height]);

  return (
    // Canvas(WebGL)内で何らかの例外が起きても画面全体が真っ白にならないよう、
    // この3D表示部分だけを局所的に受け止めるエラー境界で包む。
    <Canvas3DErrorBoundary resetKey={resetKey}>
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

        {/* 壁はほぼ透明にして、床面のヒートマップを見やすくする。 */}
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
