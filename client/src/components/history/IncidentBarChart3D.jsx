import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import PlaceholderRoom from '../room-scene/PlaceholderRoom';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds, pointInPolygon } from '../../roomShapes';

// 「危険行為の履歴」タブの3D可視化。2Dヒートマップ(ガウシアン密度)とは別に、
// 間取り図をマス目に区切り、各マスで発生した件数をそのまま3Dの棒(バー)の
// 高さとして表示する「3D棒グラフ」。数値そのもの(件数)が高さに直結するため、
// 密度のぼかしが無い分、2Dヒートマップより「どこで何件起きたか」を直感的に
// 読み取りやすい。
const CELL_M = 0.5; // 棒1本あたりのマス目の1辺(メートル)
const MAX_BAR_HEIGHT_M = 1.6;
const MIN_BAR_HEIGHT_M = 0.06;
// 棒の太さ(マス目に対する比率)。以前は0.72(マス目にほぼ隙間なく敷き詰める
// 太さ)にしていたが、部屋全体が見づらいという指摘があったため、細い柱状に
// 変更した(マス目の位置関係は変わらず、棒だけが目立ちすぎないようにする)。
const BAR_WIDTH_RATIO = 0.32;

// 配色は「危険通知の色と合わせてほしい」という要望に合わせ、アプリ内の
// 危険(danger)/注意(warning)通知で使っている色(NotificationPanel.jsx・
// HistoryPageのエリア種別などで使っている#f43f5e/#f59e0b)をそのまま
// sequentialランプの両端に採用した(発生件数が少ないマス=注意相当の橙、
// 多いマス=危険相当の赤、という読み方が既存のUIとそのままつながる)。
const LIGHT_COLOR = { r: 0xf5, g: 0x9e, b: 0x0b }; // 注意(warning) #f59e0b
const DARK_COLOR = { r: 0xf4, g: 0x3f, b: 0x5e }; // 危険(danger) #f43f5e

function colorForRatio(ratio) {
  const r = Math.round(LIGHT_COLOR.r + (DARK_COLOR.r - LIGHT_COLOR.r) * ratio);
  const g = Math.round(LIGHT_COLOR.g + (DARK_COLOR.g - LIGHT_COLOR.g) * ratio);
  const b = Math.round(LIGHT_COLOR.b + (DARK_COLOR.b - LIGHT_COLOR.b) * ratio);
  return `rgb(${r},${g},${b})`;
}

// incidents(絞り込み後の履歴)を、部屋のバウンディングボックスをCELL_M四方の
// マス目に区切って集計する(2Dヒートマップのheatセル計算と同じ考え方だが、
// ガウシアン距離減衰は使わず、単純な「そのマスに入った件数」を数える)。
function aggregateCells(incidents, footprint, bounds) {
  const cellsMap = new Map();
  incidents.forEach((inc) => {
    // 位置が概算(部屋の中心)の項目は、実際の発生位置ではないため場所別の
    // 集計には含めない(2Dヒートマップと同じ方針。含めると実データが増える
    // ほど部屋の中心に実態と異なる「ホットスポット」が出てしまうため)。
    if (inc.approx) return;
    const cx = Math.floor((inc.x - bounds.minX) / CELL_M);
    const cz = Math.floor((inc.z - bounds.minZ) / CELL_M);
    const key = `${cx}_${cz}`;
    if (!cellsMap.has(key)) {
      cellsMap.set(key, {
        x: bounds.minX + (cx + 0.5) * CELL_M,
        z: bounds.minZ + (cz + 0.5) * CELL_M,
        count: 0,
      });
    }
    cellsMap.get(key).count += 1;
  });
  return Array.from(cellsMap.values()).filter((c) => pointInPolygon(c.x, c.z, footprint));
}

function Bar({ cell, maxCount }) {
  const ratio = maxCount > 0 ? cell.count / maxCount : 0;
  const h = MIN_BAR_HEIGHT_M + ratio * (MAX_BAR_HEIGHT_M - MIN_BAR_HEIGHT_M);
  const color = colorForRatio(ratio);
  return (
    <group position={[cell.x, 0, cell.z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[CELL_M * BAR_WIDTH_RATIO, h, CELL_M * BAR_WIDTH_RATIO]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} />
      </mesh>
      <Html center distanceFactor={7} position={[0, h + 0.16, 0]} occlude={false}>
        <div
          style={{
            padding: '2px 7px',
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            color: '#fff',
            background: 'rgba(15,23,42,0.82)',
            whiteSpace: 'nowrap',
          }}
        >
          {cell.count}件
        </div>
      </Html>
    </group>
  );
}

// incidents: HistoryPage側で絞り込み済みの履歴一覧をそのまま渡す
// (カテゴリ・エリア・期間・キーワードの絞り込みが3D棒グラフにも即反映される)。
export default function IncidentBarChart3D({ incidents }) {
  const { footprint, height } = useRoomConfig();
  const { theme } = useTheme();

  const list = Array.isArray(incidents) ? incidents : [];
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const cells = useMemo(() => aggregateCells(list, footprint, bounds), [list, footprint, bounds]);
  const maxCount = useMemo(() => cells.reduce((m, c) => Math.max(m, c.count), 0), [cells]);

  const camPos = useMemo(() => [
    bounds.width * 0.8 + 1.6,
    height * 2.2 + 2.6,
    bounds.depth * 0.8 + 1.6,
  ], [bounds.width, bounds.depth, height]);

  const gridSize = Math.max(bounds.width, bounds.depth) * 1.6 + 2;
  const gridDivisions = Math.max(4, Math.round(gridSize * 2));

  return (
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

      {/* 「壁を透明にして棒を見やすく」の要望に合わせ、壁はほぼ透明(輪郭線だけが
          薄く見える程度)で表示する。各設定タブのプレビュー用solidWallsより
          さらに薄いwallOpacityを明示的に指定している。 */}
      <Suspense fallback={null}>
        <PlaceholderRoom wallOpacity={0.06} />
      </Suspense>

      {cells.map((c) => (
        <Bar key={`${c.x}_${c.z}`} cell={c} maxCount={maxCount} />
      ))}

      <gridHelper args={[gridSize, gridDivisions, theme.sceneGrid1, theme.sceneGrid2]} position={[0, 0.001, 0]} />
      <OrbitControls enableDamping dampingFactor={0.1} minDistance={0.8} maxDistance={24} />
    </Canvas>
  );
}
