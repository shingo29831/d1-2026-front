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
import { CATEGORIES } from './incidentHistory';

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

// ===================================================================
// 「ヒートマップの多いところをクリックしたら、そこで何が起きたか吹き出しで
// 見たい」という要望への対応。computeHeatCells()のマス目分布とは別に、実際の
// incidentsそのものを座標が近いもの同士でグルーピングし(貪欲な距離クラスタ
// リング)、クリック可能なホットスポット(件数バッジ)を作るための下ごしらえ。
// ===================================================================

// 1件のクラスタ(members=近接するincidentsの配列)から、吹き出しに表示する
// 「カテゴリ内訳(件数の多い順)」と「直近3件」を組み立てる。
function buildHotspot(members, x, z) {
  const byCategory = new Map();
  members.forEach((m) => {
    const key = m.category || 'other';
    byCategory.set(key, (byCategory.get(key) || 0) + 1);
  });
  const categoryBreakdown = Array.from(byCategory.entries())
    .map(([key, count]) => {
      const meta = CATEGORIES.find((c) => c.key === key);
      return { key, count, label: meta ? meta.label : key, color: meta ? meta.color : '#94a3b8' };
    })
    .sort((a, b) => b.count - a.count);
  const recent = [...members]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 3);
  return { x, z, count: members.length, categoryBreakdown, recent };
}

// incidents(位置(x,z)を持つ履歴一覧)を、半径radius(メートル)以内にある
// もの同士でグルーピングし、件数がminCount以上のクラスタだけをホットスポット
// として返す。ヒートマップと同じ「概算(部屋の中心)」項目・不正な座標の項目は
// 除外する(computeHeatCells()と同じ方針)。
//
// アルゴリズムは単純な貪欲法: 未割当の1件を起点にクラスタを作り、クラスタの
// 重心(件数が増えるたびに再計算)からradius以内にある未割当の項目を、変化が
// 無くなるまで繰り返し取り込んでいく。厳密な密度クラスタリングではないが、
// 「近くで繰り返し起きている場所」を吹き出しの対象として拾う用途には十分。
export function clusterIncidentHotspots(incidents, { radius = 0.8, minCount = 2 } = {}) {
  const list = (Array.isArray(incidents) ? incidents : []).filter(
    (inc) => inc && !inc.approx && Number.isFinite(inc.x) && Number.isFinite(inc.z)
  );
  const used = new Array(list.length).fill(false);
  const clusters = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    const members = [list[i]];
    used[i] = true;
    let cx = list[i].x;
    let cz = list[i].z;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < list.length; j++) {
        if (used[j]) continue;
        const dx = list[j].x - cx;
        const dz = list[j].z - cz;
        if (Math.hypot(dx, dz) <= radius) {
          members.push(list[j]);
          used[j] = true;
          changed = true;
          cx = members.reduce((s, m) => s + m.x, 0) / members.length;
          cz = members.reduce((s, m) => s + m.z, 0) / members.length;
        }
      }
    }
    if (members.length >= minCount) {
      clusters.push(buildHotspot(members, cx, cz));
    }
  }
  // 件数の多いクラスタから順に返す(バッジの重なり順・視認性のため)。
  return clusters.sort((a, b) => b.count - a.count);
}

// HistoryPage.jsxの日時表示と同じフォーマット(月/日 時:分:秒)。吹き出しの
// 「直近3件」の各行に使う。
export function formatIncidentDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// HistoryPage.jsxと同じ「◯分前/◯時間前/◯日前」形式の相対時刻表示。
export function formatIncidentRelative(iso, nowMs = Date.now()) {
  const diffMs = nowMs - new Date(iso).getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))}分前`;
  if (diffH < 24) return `${Math.round(diffH)}時間前`;
  return `${Math.round(diffH / 24)}日前`;
}
