import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import PlaceholderRoom from '../room-scene/PlaceholderRoom';
import Canvas3DErrorBoundary from '../room-scene/Canvas3DErrorBoundary';
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
    if (!inc || inc.approx) return;
    // 位置がNaN・Infinityなど不正な値の履歴は集計マス目のキーが壊れる
    // (Map上で"NaN_NaN"のような不正なキーに紐づいてしまう)ため明示的に除外する。
    if (!Number.isFinite(inc.x) || !Number.isFinite(inc.z)) return;
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

// 家具は、3D棒グラフでは棒の高さ比較の邪魔にならないよう、立体の箱ではなく
// 床に敷いた色付きの平面(2D)として表示する(「家具は立体にしないで2Dに
// 色だけ配色してほしい」という要望への対応)。位置(x, z)・サイズ(width, depth)・
// 回転(rotationDeg)・色はPlaceholderRoomの3D家具描画と同じ値をそのまま使う。
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

// 各棒の高さ(メートル)を、そのマスの件数と最大件数の比率から求める
// (InstancedBars・BarLabelsの両方で同じ計算式を使うため、共通関数として切り出す)。
function barHeight(cell, maxCount) {
  const ratio = maxCount > 0 ? cell.count / maxCount : 0;
  return MIN_BAR_HEIGHT_M + ratio * (MAX_BAR_HEIGHT_M - MIN_BAR_HEIGHT_M);
}

// setMatrixAt/setColorAtの計算専用に使い回す作業用オブジェクト。
// 毎フレーム・毎セルごとに新しいTHREE.Object3D/THREE.Colorを生成すると
// ガベージコレクションの負荷が増えるため、モジュールスコープで1つだけ用意し、
// 使うたびに値を上書きする(three.js/@react-three/fiberでよく使われる定石)。
const dummyObject = new THREE.Object3D();
const dummyColor = new THREE.Color();

// 【Role C仕様書 Step 5 対応】履歴データが増えてマス目(cells)が数百〜数千に
// なっても、個別の<mesh>を積み上げるとドローコールが人数分(セル数分)に
// 増大してFPSが著しく低下する(仕様書で明示的に禁止されている実装)。
// そのため、全ての棒を1個の<instancedMesh>・1回のドローコールで描画する。
// 位置・高さ・色は、cellsが変わるたびにuseEffect内でsetMatrixAt/setColorAtを
// 使って書き込む(Reactの再描画のたびに毎回インスタンス数ぶんの<mesh>を
// 生成・破棄するのではなく、既存のバッファへ直接書き込むことでコストを抑える)。
function InstancedBars({ cells, maxCount }) {
  const meshRef = useRef(null);
  const count = cells.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    cells.forEach((cell, i) => {
      const h = barHeight(cell, maxCount);
      // ジオメトリ自体は1辺1(単位立方体)のboxGeometryを使い回し、
      // インスタンスごとのスケール(scale)で実際の太さ・高さに変形する。
      dummyObject.position.set(cell.x, h / 2, cell.z);
      dummyObject.scale.set(CELL_M * BAR_WIDTH_RATIO, h, CELL_M * BAR_WIDTH_RATIO);
      dummyObject.rotation.set(0, 0, 0);
      dummyObject.updateMatrix();
      mesh.setMatrixAt(i, dummyObject.matrix);

      const ratio = maxCount > 0 ? cell.count / maxCount : 0;
      dummyColor.set(colorForRatio(ratio));
      mesh.setColorAt(i, dummyColor);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cells, maxCount, count]);

  // countが変わるとargsも変わるため、@react-three/fiberが古いinstancedMeshを
  // 破棄して新しく作り直す(instancedMeshのインスタンス数は生成後に変更できない
  // three.jsの仕様のため)。0件のときはメッシュ自体を描画しない。
  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.5} metalness={0.05} />
    </instancedMesh>
  );
}

// 件数バッジ(「◯件」の吹き出し)は棒の本数ぶんだけ必要なDOM要素(<Html>)のため、
// InstancedMeshには含められない。ただしこちらはWebGLのドローコールを消費する
// ものではなく(通常のDOM要素としてオーバーレイ表示される)、棒の描画とは別の
// コンポーネントに分離しても、上記InstancedBarsのパフォーマンス最適化には
// 影響しない。
function BarLabels({ cells, maxCount }) {
  return (
    <>
      {cells.map((cell) => {
        const h = barHeight(cell, maxCount);
        return (
          <Html
            key={`${cell.x}_${cell.z}`}
            center
            distanceFactor={7}
            position={[cell.x, h + 0.16, cell.z]}
            occlude={false}
          >
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
        );
      })}
    </>
  );
}

// incidents: HistoryPage側で絞り込み済みの履歴一覧をそのまま渡す
// (カテゴリ・エリア・期間・キーワードの絞り込みが3D棒グラフにも即反映される)。
export default function IncidentBarChart3D({ incidents }) {
  const { footprint, height, furniture } = useRoomConfig();
  const { theme } = useTheme();
  const furnitureList = Array.isArray(furniture) ? furniture : [];

  const list = Array.isArray(incidents) ? incidents : [];
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const cells = useMemo(() => aggregateCells(list, footprint, bounds), [list, footprint, bounds]);
  const maxCount = useMemo(() => cells.reduce((m, c) => Math.max(m, c.count), 0), [cells]);

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

        {/* 「壁を透明にして棒を見やすく」の要望に合わせ、壁はほぼ透明(輪郭線だけが
            薄く見える程度)で表示する。各設定タブのプレビュー用solidWallsより
            さらに薄いwallOpacityを明示的に指定している。furniture={[]}を渡して
            PlaceholderRoom自体には家具を描かせず(立体の箱にしない)、下の
            FlatFurnitureで平面の色だけの表示に差し替える。 */}
        <Suspense fallback={null}>
          <PlaceholderRoom wallOpacity={0.06} furniture={[]} />
        </Suspense>

        {furnitureList.map((f) => (
          <FlatFurniture key={f.id} item={f} />
        ))}

        <InstancedBars cells={cells} maxCount={maxCount} />
        <BarLabels cells={cells} maxCount={maxCount} />

        {/* 「3D表示の下のあみあみ(網目)を消してほしい」という要望を受けてgridHelperを削除。 */}
        <OrbitControls enableDamping dampingFactor={0.1} minDistance={0.8} maxDistance={24} />
      </Canvas>
    </Canvas3DErrorBoundary>
  );
}
