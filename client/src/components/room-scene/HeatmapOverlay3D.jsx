import React, { useMemo } from 'react';
import * as THREE from 'three';
import { footprintBounds } from '../../roomShapes';
import { HEATMAP_CELL_M, computeHeatCells, heatColorForRatio } from '../../incidentHeatmap';

// 見守りダッシュボード(自由視点)の「ヒートマップ」ボタンを押したときに、床面へ
// 重ねて表示する危険行為の発生密度ヒートマップ。マス目ごとの発生密度計算自体は
// 「危険行為の履歴」タブの3Dヒートマップ(history/IncidentHeatmap3D.jsx)と同じ
// (incidentHeatmap.js)を使い、見た目の一貫性を持たせている。
//
// 【見た目の調整】以前はマス目1つ1つを単色の板として並べていたため、
// 「下がマス目(チェック柄)のように見える」「全体がぼんやり色付いて危険度の
// 高い場所が見にくい」という指摘があった。そこで、
//   1) マス目の発生密度を小さなキャンバス(セル数と同じ解像度)に書き込み、
//      それをテクスチャとして1枚の床パネルに貼ることで、GPU側の補間により
//      マス目の境界線が出ない滑らかなグラデーションにする。
//   2) 密度が低いマスは完全に透明にし(発生がほぼ無い場所まで薄く色が付いて
//      全体がぼやける状態を避ける)、残ったマスは べき乗カーブでメリハリを
//      強めてから配色することで、発生が多い場所ほどはっきり目立つようにする。
const HEAT_GAMMA = 1.6; // 1より大きいほど、低密度がより薄く・高密度がより濃く強調される
const HEAT_MIN_NORM = 0.15; // これ未満の密度のマスは表示しない(全体がぼやけて見えるのを防ぐ)
const HEAT_MAX_OPACITY = 0.82;

// computeHeatCells()が返す「発生しているマスだけの一覧」を、マス目の行・列
// インデックスをキーにした密な2次元配列に並べ直す(存在しないマス=発生なしの
// 場所は0のまま=完全に透明として扱う)。
function buildHeatGrid(cells, bounds) {
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / HEATMAP_CELL_M));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / HEATMAP_CELL_M));
  const norms = new Float32Array(nx * nz);
  cells.forEach((c) => {
    const ix = Math.round((c.x - bounds.minX - HEATMAP_CELL_M / 2) / HEATMAP_CELL_M);
    const iz = Math.round((c.z - bounds.minZ - HEATMAP_CELL_M / 2) / HEATMAP_CELL_M);
    if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) return;
    norms[iz * nx + ix] = c.norm;
  });
  return { norms, nx, nz };
}

// 上記の密な2次元配列から、GPUのバイリニア補間でそのまま滑らかに拡大表示できる
// 小さなテクスチャ(1マス=1ピクセル)を作る。
function buildHeatTexture(grid) {
  const { norms, nx, nz } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = nx;
  canvas.height = nz;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(nx, nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const norm = norms[iz * nx + ix];
      const idx = (iz * nx + ix) * 4;
      if (norm < HEAT_MIN_NORM) {
        image.data[idx + 3] = 0;
        continue;
      }
      const boosted = Math.pow(norm, HEAT_GAMMA);
      const color = heatColorForRatio(boosted).match(/\d+/g);
      image.data[idx] = Number(color[0]);
      image.data[idx + 1] = Number(color[1]);
      image.data[idx + 2] = Number(color[2]);
      image.data[idx + 3] = Math.round(Math.min(1, boosted) * HEAT_MAX_OPACITY * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export default function HeatmapOverlay3D({ incidents, footprint }) {
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const cells = useMemo(() => computeHeatCells(incidents, footprint, bounds), [incidents, footprint, bounds]);
  const grid = useMemo(() => buildHeatGrid(cells, bounds), [cells, bounds]);
  const texture = useMemo(
    () => (typeof document !== 'undefined' ? buildHeatTexture(grid) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid.norms, grid.nx, grid.nz]
  );

  if (!texture || cells.length === 0) return null;

  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  return (
    <mesh position={[centerX, 0.016, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
