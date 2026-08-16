import React, { useMemo } from 'react';
import * as THREE from 'three';
import { footprintBounds } from '../../roomShapes';
import { HEATMAP_CELL_M, computeHeatCells, heatColorForRatio } from '../../incidentHeatmap';

// 見守りダッシュボード(俯瞰3D)の「ヒートマップ」ボタンを押したときに、床面へ
// 重ねて表示する危険行為の発生密度ヒートマップ。「危険行為の履歴」タブの
// 3Dヒートマップ(history/IncidentHeatmap3D.jsx)と同じ計算(incidentHeatmap.js)を
// そのまま使い、見た目の一貫性を持たせている。RoomScene.jsxのCanvas内から
// 呼び出す想定(footprint・incidentsはRoomScene側からpropsで受け取る)。
function HeatCell({ cell }) {
  const color = heatColorForRatio(cell.norm);
  const opacity = Math.min(0.78, cell.norm * 0.78);
  return (
    <mesh position={[cell.x, 0.016, cell.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[HEATMAP_CELL_M + 0.02, HEATMAP_CELL_M + 0.02]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function HeatmapOverlay3D({ incidents, footprint }) {
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const cells = useMemo(() => computeHeatCells(incidents, footprint, bounds), [incidents, footprint, bounds]);

  return (
    <group>
      {cells.map((c, i) => <HeatCell key={i} cell={c} />)}
    </group>
  );
}
