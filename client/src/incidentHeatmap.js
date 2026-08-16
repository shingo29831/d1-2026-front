// ===================================================================
// 危険行為の履歴(incidents)から、間取り図上の発生密度ヒートマップを計算する
// 共通ロジック。もともとは「危険行為の履歴」タブの3Dヒートマップ
// (history/IncidentHeatmap3D.jsx)専用に実装していたが、「見守りダッシュボード
// にもヒートマップを表示できるボタンがほしい」という要望を受け、見守り
// ダッシュボード(room-scene/HeatmapOverlay3D.jsx)側でも同じ計算をそのまま
// 使い回せるよう、ここに切り出した(2箇所で見た目・計算方法がズレないように
// するため)。
// ===================================================================
import { pointInPolygon } from './roomShapes';

export const HEATMAP_CELL_M = 0.35; // マス目1辺のサイズ(メートル)
export const HEATMAP_SIGMA_M = 0.9; // ガウシアンぼかしの広がり(メートル)

// 危険(danger)/注意(warning)通知と同じ配色(#f59e0b→#f43f5e)のsequentialランプ。
const LIGHT_COLOR = { r: 0xf5, g: 0x9e, b: 0x0b }; // 注意(warning) #f59e0b
const DARK_COLOR = { r: 0xf4, g: 0x3f, b: 0x5e }; // 危険(danger) #f43f5e

export function heatColorForRatio(ratio) {
  const r = Math.round(LIGHT_COLOR.r + (DARK_COLOR.r - LIGHT_COLOR.r) * ratio);
  const g = Math.round(LIGHT_COLOR.g + (DARK_COLOR.g - LIGHT_COLOR.g) * ratio);
  const b = Math.round(LIGHT_COLOR.b + (DARK_COLOR.b - LIGHT_COLOR.b) * ratio);
  return `rgb(${r},${g},${b})`;
}

// incidents(位置(x,z)を持つ履歴一覧)・footprint(部屋の外形)・bounds
// (footprintBounds()の結果)から、マス目ごとの発生密度(カーネル密度推定)を求める。
// 【重要】位置がNaN・Infinityなど不正な値の履歴が混ざっていても計算全体が
// 壊れない(NaNが1件でも積算されるとそのマスの密度が丸ごとNaNになり、
// 3D描画側でジオメトリのサイズ・色計算が破綻して例外につながりうるため)よう、
// Number.isFinite() で明示的に除外してから計算する。
export function computeHeatCells(incidents, footprint, bounds) {
  const list = Array.isArray(incidents) ? incidents : [];
  const cells = [];
  const twoSigma2 = 2 * HEATMAP_SIGMA_M * HEATMAP_SIGMA_M;
  for (let cx = bounds.minX + HEATMAP_CELL_M / 2; cx < bounds.maxX; cx += HEATMAP_CELL_M) {
    for (let cz = bounds.minZ + HEATMAP_CELL_M / 2; cz < bounds.maxZ; cz += HEATMAP_CELL_M) {
      if (!pointInPolygon(cx, cz, footprint)) continue;
      let intensity = 0;
      for (const inc of list) {
        // 位置が概算(部屋の中心)の項目は密度計算に含めない(実データが増える
        // ほど部屋の中心に実態と異なる「ホットスポット」が出てしまうため)。
        if (!inc || inc.approx) continue;
        if (!Number.isFinite(inc.x) || !Number.isFinite(inc.z)) continue;
        const dx = cx - inc.x;
        const dz = cz - inc.z;
        intensity += Math.exp(-(dx * dx + dz * dz) / twoSigma2);
      }
      if (intensity > 0.02) cells.push({ x: cx, z: cz, intensity });
    }
  }
  const max = cells.reduce((m, c) => Math.max(m, c.intensity), 0.0001);
  cells.forEach((c) => { c.norm = c.intensity / max; });
  return cells;
}
