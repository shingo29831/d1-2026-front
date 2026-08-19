import React, { useEffect, useMemo, useState } from 'react';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { useOperationMode } from '../../operationModeContext';
import { useViewport } from '../../hooks/useViewport';
import { footprintBounds, footprintCenter, footprintEdges, pointInPolygon } from '../../roomShapes';
import { isInsideZone, imageToFloor } from '../../poseGeometry';
import { getIncidentsSortedDesc, CATEGORIES, GROUPS } from '../../incidentHistory';
import { fetchIncidentsSortedDesc } from '../../historyApi';
import IncidentHeatmap3D from './IncidentHeatmap3D';
import InfoButton from '../common/InfoButton';

// エリア外の履歴をまとめて選べるようにするための特別な選択値
// (「家具・エリアの設定」タブで定義した、どの危険/注意エリアの矩形にも
// 入っていない履歴。例: リビング中央でのつまずきなど)。
const OUTSIDE_AREA_ID = '__outside__';

// 指定した履歴が、現在設定されているどのエリア(zones)の範囲内で発生したかを判定する。
// 「家具・エリアの設定」タブで自由に追加・移動・削除できるエリアに合わせて動的に
// 判定するため、後から追加したエリアも自動的に絞り込みの対象になる。
// 複数のエリアが重なっている場合は、先に見つかった方(zones配列の先頭側)を採用する。
function zoneIdForIncident(inc, zones) {
  const list = Array.isArray(zones) ? zones : [];
  const hit = list.find((zone) => isInsideZone({ x: inc.x, z: inc.z }, zone));
  return hit ? hit.id : null;
}

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const CELL_M = 0.35; // ヒートマップのマス目1辺のサイズ(メートル)
const SIGMA_M = 0.9; // ガウシアンぼかしの広がり(メートル)

const ALL_CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

// 「見やすく・簡単に絞り込みできるように」の一環で追加した期間フィルター。
// 'all'以外はnowMs(ページを開いた時刻)からの経過時間で絞り込む簡易な実装
// (実データ規模になった場合は、期間指定をAPI側のクエリパラメータに渡す形へ
// 置き換える想定。ROLE_C_SPEC_ALIGNMENT.md参照)。
const DATE_RANGES = [
  { key: 'all', label: '全期間' },
  { key: '24h', label: '過去24時間' },
  { key: '7d', label: '過去7日間' },
  { key: '30d', label: '過去30日間' },
];
const DATE_RANGE_MS = { '24h': 24 * 3600000, '7d': 7 * 24 * 3600000, '30d': 30 * 24 * 3600000 };

// 秒単位まで表示する(以前は時:分までだったため、短時間に連続した履歴の
// 前後関係が分かりにくかった)。
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatRelative(iso, nowMs) {
  const diffMs = nowMs - new Date(iso).getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))}分前`;
  if (diffH < 24) return `${Math.round(diffH)}時間前`;
  return `${Math.round(diffH / 24)}日前`;
}

// 「危険行為の履歴」タブ。転倒検知・危険/注意エリアへの接近の履歴一覧と、
// どのあたりで多く発生しているかを間取り図上のヒートマップで可視化する。
// 危険行為の種類(CATEGORIES)に加えて、「家具・エリアの設定」タブで自由に
// 追加・削除できるエリア(zones)ごとの絞り込みにも対応している
// (zoneIdForIncident()で履歴の座標(x,z)がどのエリアの矩形内かを判定するため、
// 後から追加したエリアも自動的に絞り込みの選択肢に反映される)。
// 【Role C仕様書 Step 5「履歴データの可視化(ヒートマップ)」との対応】
// 仕様書ではRole BのAPI(JWTトークン付き)から履歴データを取得し、大量の
// データポイントを`InstancedMesh`等でGPU側一括描画する想定だが、このページは
// 間取り図上のSVGによるカーネル密度ヒートマップ(件数が少ないモックデータ向け)
// になっている。実データ規模のAPI・3D空間上のパーティクル描画への移行手順は
// ROLE_C_SPEC_ALIGNMENT.mdを参照。
// 【重要】履歴データはhistoryApi.js経由で取得する。client/.env に
// VITE_HISTORY_API_URLが設定されていれば実際のAPI(Cognito IDトークン付き)
// から取得し、未設定の場合・APIの形式が想定と異なる場合・通信に失敗した場合は
// incidentHistory.js の直書きサンプルデータに自動フォールバックする
// (画面上部にどちらを表示しているかの案内が出る)。将来的には
// useMonitoringAlerts.jsの通知をそのままAPI側に蓄積していく形を想定。
export default function HistoryPage() {
  const { footprint, walls, zones, cameraMount, cameraYawDeg } = useRoomConfig();
  const { theme } = useTheme();
  const { isProduction } = useOperationMode();
  const { isMobile } = useViewport();
  // 既定では全種類を選択状態にし、「すべての危険行為」をまとめて表示する。
  // 個別のチップを外すことで、その危険行為だけに絞り込んだ表示にもできる
  // (=すべての表示と、各危険行為ごとの個別表示の両方に対応)。
  const [selectedCategories, setSelectedCategories] = useState(() => new Set(ALL_CATEGORY_KEYS));
  // エリアごとの絞り込み。null = 絞り込みなし(すべてのエリア)。
  // 「家具・エリアの設定」タブで追加/削除したエリアがそのままここの選択肢になる。
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  // 期間の絞り込み('all'|'24h'|'7d'|'30d')とキーワード検索(発生内容のlabelに部分一致)。
  // 「見やすく・簡単に絞り込みできるように」の追加分。
  const [dateRangeKey, setDateRangeKey] = useState('all');
  const [searchText, setSearchText] = useState('');
  // 間取り図の可視化モード。'heatmap'=2Dヒートマップ(既定)、'3d'=3Dヒートマップ。
  // 【2026-08-19further変更】「棒グラフは削除してヒートマップのみでよい」という
  // ご要望を受け、3D表示のときに「ヒートマップ」か「棒グラフ」かを選べる
  // サブ切り替え(mode3d)は廃止した。3D表示は常にIncidentHeatmap3D(ヒートマップ)
  // のみを表示する(IncidentBarChart3D.jsxはこのページからは使わなくなったが、
  // ファイル自体は削除せず残してある)。
  const [mapMode, setMapMode] = useState('heatmap');
  // 絞り込みバーの開閉状態。項目が増えて縦に長くなり見づらいという指摘が
  // あったため、既定では折りたたんでおき(件数サマリーとリセットだけは常に見える)、
  // 「絞り込み」ボタンを押したときだけキーワード・期間・種類・エリアの各項目を
  // 展開表示する。
  const [filterOpen, setFilterOpen] = useState(false);

  // 履歴データの取得状態。
  // デモ用データモードでは、初期値としてモックデータを先に表示しておき(画面が
  // 空にならないよう)、裏でAPIへの取得を試みて成功したら差し替える。
  // 【重要】本番環境モードでは、サンプルデータを「それらしく」先に見せてしまうと
  // 実際にはまだ何も取得できていないことに気づきにくいため、初期値は空にし、
  // 取得できるまでは「読み込み中」の表示のままにする(historyApi.js参照)。
  const [historyState, setHistoryState] = useState(() => (
    isProduction
      ? { incidents: [], source: 'error', error: null, loading: true }
      : { incidents: getIncidentsSortedDesc(), source: 'mock', error: null, loading: true }
  ));

  useEffect(() => {
    let cancelled = false;
    setHistoryState((prev) => ({ ...prev, loading: true }));
    fetchIncidentsSortedDesc({ isProduction }).then((result) => {
      if (!cancelled) setHistoryState({ ...result, loading: false });
    });
    return () => { cancelled = true; };
  }, [isProduction]);

  // historyApi.js経由の実データは、位置(x, z)が不明な項目(現状"ai_hazard"等の
  // 多くがこれに該当。画像上のピクセル座標しか無く、カメラキャリブレーション
  // 行列が未受領のため床座標に変換できていない)が x: null, z: null で返ってくる。
  // そのままでは間取り図上に描けないため、ここで部屋の中心に概算配置し、
  // approx: true を付けておく(一覧・ヒートマップ側で「概算」と明示する)。
  //
  // 【2026-08-19further変更・不具合修正】「危険行為履歴のヒートマップが、見守り
  // ダッシュボードのヒートマップと違ってほとんど何も表示されない」という報告
  // への対応。原因は、AIリスクサジェスト(risk_suggestion)には実はピクセル座標
  // (rawX, rawY)が付いており、見守りダッシュボード側(MonitoringDashboard.jsx の
  // heatmapIncidents)ではそれをimageToFloor()でカメラの設置位置・向きから床座標
  // へ変換し、approx: false(=密度計算に含める)として扱っていたが、この履歴
  // ページ側は同じ変換をしておらず、AIリスクサジェストも一律approx: trueの
  // 部屋中心固定にしてしまい、密度計算(incidentHeatmap.js)から除外されていた
  // ため。ダッシュボード側と全く同じ変換ロジックをここにも適用する。
  const roomCenter = useMemo(() => footprintCenter(footprint), [footprint]);
  const allIncidents = useMemo(
    () => historyState.incidents.map((i) => {
      if (i.type === 'risk_suggestion' && i.rawX != null && i.rawY != null) {
        const floorPos = imageToFloor(i.rawX, i.rawY, { footprint, cameraMount, cameraYawDeg });
        // APIから返るradius(ピクセル単位)をメートル単位に近似変換する(例: 100px = 1m)。
        const radiusM = i.radius ? Math.min(Math.max(i.radius / 100, 0.5), 2.0) : 1.0;
        return { ...i, x: floorPos.x, z: floorPos.z, radius: radiusM, approx: false };
      }
      return i.x === null || i.x === undefined || i.z === null || i.z === undefined
        ? { ...i, x: roomCenter.x, z: roomCenter.z, approx: true }
        : i;
    }),
    [historyState.incidents, roomCenter, footprint, cameraMount, cameraYawDeg],
  );
  // nowMs: ページを開いた時刻(以後は固定)。期間フィルター('過去24時間'等)の
  // 起点、および履歴一覧の相対時刻表示(formatRelative)の両方で使う。
  const nowMs = useMemo(() => Date.now(), []);

  const incidents = useMemo(
    () => allIncidents.filter((i) => {
      if (!selectedCategories.has(i.category)) return false;
      if (selectedAreaId !== null) {
        const zid = zoneIdForIncident(i, zones);
        if (selectedAreaId === OUTSIDE_AREA_ID) {
          if (zid !== null) return false;
        } else if (zid !== selectedAreaId) {
          return false;
        }
      }
      if (dateRangeKey !== 'all') {
        const rangeMs = DATE_RANGE_MS[dateRangeKey];
        if (nowMs - new Date(i.time).getTime() > rangeMs) return false;
      }
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        if (!i.label.toLowerCase().includes(q)) return false;
      }
      return true;
    }),
    [allIncidents, selectedCategories, selectedAreaId, zones, dateRangeKey, searchText, nowMs],
  );

  const toggleCategory = (key) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectAllCategories = () => setSelectedCategories(new Set(ALL_CATEGORY_KEYS));
  const allSelected = selectedCategories.size === ALL_CATEGORY_KEYS.length;
  // 【2026-08-19further変更】「履歴一覧の右側の端っこに絞り込みボタンを配置して
  // ほしい」というご要望に伴い、見出し行の絞り込みボタンに「現在絞り込み中か」
  // をひと目で分かるバッジを付けるために追加。何かひとつでも既定値から変わって
  // いれば絞り込み中とみなす。
  const isFilterActive = !allSelected || selectedAreaId !== null || dateRangeKey !== 'all' || searchText.trim() !== '';

  // 転倒・誤飲・危険エリアへの接近など、「その状態だけ」に一発で絞り込むためのクイック
  // フィルター(GROUPS参照)。CATEGORIESの詳細チップとは別に、履歴一覧(右側)の
  // 上部にも置くことで、右側だけを見ていてもその場で絞り込めるようにしている。
  const selectOnlyGroup = (categories) => setSelectedCategories(new Set(categories));
  const isGroupActive = (categories) => (
    categories.length === selectedCategories.size && categories.every((k) => selectedCategories.has(k))
  );

  const categoryCounts = useMemo(() => {
    const counts = {};
    ALL_CATEGORY_KEYS.forEach((k) => { counts[k] = 0; });
    allIncidents.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    return counts;
  }, [allIncidents]);

  const groupCounts = useMemo(() => {
    const counts = {};
    GROUPS.forEach((g) => {
      counts[g.key] = allIncidents.filter((i) => g.categories.includes(i.category)).length;
    });
    return counts;
  }, [allIncidents]);

  // エリアごとの絞り込みチップ用の件数。現在設定されているエリア(zones)ごとに、
  // そのエリアの矩形内で発生した履歴の件数を数える(「エリア外」も別枠で集計)。
  const zoneList = Array.isArray(zones) ? zones : [];
  const areaCounts = useMemo(() => {
    const counts = {};
    zoneList.forEach((z) => { counts[z.id] = 0; });
    let outside = 0;
    allIncidents.forEach((i) => {
      const zid = zoneIdForIncident(i, zoneList);
      if (zid) counts[zid] = (counts[zid] || 0) + 1;
      else outside += 1;
    });
    counts[OUTSIDE_AREA_ID] = outside;
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIncidents, zones]);

  const selectAllAreas = () => setSelectedAreaId(null);

  // 「見やすく・簡単に絞り込みができるように」の一環で追加した、全フィルターを
  // 一括で初期状態に戻すボタン用のハンドラ(種類・エリア・期間・キーワードすべて)。
  const resetAllFilters = () => {
    setSelectedCategories(new Set(ALL_CATEGORY_KEYS));
    setSelectedAreaId(null);
    setDateRangeKey('all');
    setSearchText('');
  };

  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const scale = useMemo(() => {
    const spanX = bounds.width + 1.2;
    const spanZ = bounds.depth + 1.2;
    return Math.min((SVG_W - PAD * 2) / spanX, (SVG_H - PAD * 2) / spanZ);
  }, [bounds]);
  const originX = SVG_W / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const originY = SVG_H / 2 - ((bounds.minZ + bounds.maxZ) / 2) * scale;
  const roomToSvg = (x, z) => ({ sx: originX + x * scale, sy: originY + z * scale });

  const polygonPoints = footprint.map((p) => {
    const { sx, sy } = roomToSvg(p.x, p.z);
    return `${sx},${sy}`;
  }).join(' ');

  const edges = useMemo(() => footprintEdges(footprint), [footprint]);

  // ヒートマップ: 部屋のバウンディングボックスをCELL_M四方のマス目に区切り、
  // 各マスの中心から各インシデントまでのガウシアン距離減衰を積み上げて
  // 「密度」を求める(単純なカーネル密度推定)。部屋の外形の外側のマスは除外する。
  const heatCells = useMemo(() => {
    const cells = [];
    const twoSigma2 = 2 * SIGMA_M * SIGMA_M;
    for (let cx = bounds.minX + CELL_M / 2; cx < bounds.maxX; cx += CELL_M) {
      for (let cz = bounds.minZ + CELL_M / 2; cz < bounds.maxZ; cz += CELL_M) {
        if (!pointInPolygon(cx, cz, footprint)) continue;
        let intensity = 0;
        for (const inc of incidents) {
          // 位置が概算(部屋の中心)の項目は、実際の発生位置ではないため密度計算には
          // 含めない(含めると、実データが増えるほど部屋の中心に実態と異なる
          // 「ホットスポット」が表示されてしまうため)。個別マーカーとしては表示する。
          if (inc.approx) continue;
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
  }, [bounds, footprint, incidents]);

  const cellSizeSvg = CELL_M * scale + 0.6; // 隙間なく敷き詰めるため少し大きめに

  const catColor = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color])), []);
  const catLabel = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])), []);

  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  const dangerCount = allIncidents.filter((i) => i.severity === 'danger').length;
  const warningCount = allIncidents.filter((i) => i.severity === 'warning').length;

  return (
    <div style={s.page}>
      {/* 【2026-08-19変更】以前はここに長い説明文を常時表示していたが、
          「タイトルの横にiボタンを追加して、押したら説明をモーダルで画面中央に
          表示するようにしてほしい」というご要望を受け、InfoButton(共通部品)
          経由の表示に変更した。 */}
      <h2 style={s.h2}>
        危険行為の履歴
        <InfoButton title="危険行為の履歴について">
          転倒検知・危険/注意エリアへの接近の履歴と、間取り図上でどのあたりに多く発生しているかを
          ヒートマップで確認できます。色が濃い(赤みが強い)場所ほど、発生回数が多いエリアです。
        </InfoButton>
      </h2>

      {/* 【重要】デモ用データモードでは、履歴APIの設定有無に関わらず実データへは
          通信せず、常にこの端末で自由に追加・編集・削除できるサンプルデータを
          表示する(historyApi.js参照。ハンバーガーメニュー「管理画面」→「危険行為
          履歴データの編集」から編集できる)。 */}
      {!historyState.loading && historyState.source === 'mock' && (
        <p style={s.dataSourceNote}>
          ※ デモ用データモードのため、サンプルデータを表示しています。管理画面の「危険行為履歴データの編集」から自由に追加・編集・削除できます。
        </p>
      )}
      {!historyState.loading && historyState.source === 'api' && (
        <p style={s.dataSourceNoteOk}>✓ 履歴API(実データ)から取得した内容を表示しています。</p>
      )}
      {/* 【重要】本番環境モードでは、取得に失敗してもサンプルデータへ差し替えない
          (historyApi.js参照)。「一見動いているように見えるが実は取得できていない」
          という誤解を避けるため、はっきりとしたエラー表示にする。 */}
      {!historyState.loading && historyState.source === 'error' && (
        <p style={s.dataSourceNoteError}>
          ✕ 本番環境モードのため、サンプルデータへの切り替えは行っていません。履歴データを取得できませんでした{historyState.error ? `(${historyState.error})` : ''}。接続状況ページでAWS(Cognito・履歴API)の状態をご確認ください。
        </p>
      )}
      {historyState.loading && (
        <p style={s.dataSourceNote}>読み込み中…</p>
      )}

      <div style={s.statRow}>
        <div style={s.statCard}>
          <div style={s.statNum}>{allIncidents.length}</div>
          <div style={s.statLabel}>件数(全期間)</div>
        </div>
        <div style={{ ...s.statCard, borderColor: theme.danger }}>
          <div style={{ ...s.statNum, color: theme.danger }}>{dangerCount}</div>
          <div style={s.statLabel}>危険(赤)</div>
        </div>
        <div style={{ ...s.statCard, borderColor: theme.warning }}>
          <div style={{ ...s.statNum, color: theme.warning }}>{warningCount}</div>
          <div style={s.statLabel}>注意(橙)</div>
        </div>
      </div>

      <div style={s.grid}>
        <section style={{ ...s.card, ...s.listCard }}>
          {/* 「見やすく・簡単に絞り込みができるように」で追加した、共通の絞り込みバー。
              キーワード検索・期間のクイックフィルター・全リセットボタンをここに
              まとめてある(絞り込み結果はヒートマップ・3D棒グラフ・一覧すべてに
              即反映される)。【2026-08-19変更】「絞り込みは履歴一覧につけてほしい」
              というご要望を受け、以前はヒートマップの上に独立して置いていたこの
              絞り込みバーを、履歴一覧セクションの中(見出しの直下)へ移動した。
              【2026-08-19further変更】「履歴一覧の絞り込みもモーダル化してほしい」
              というご要望を受け、キーワード・期間・種類・エリアの詳細な絞り込み
              項目は、この場でインライン展開するのをやめてモーダルで表示するように
              変更した。
              【2026-08-19further2変更】「履歴一覧の右側の端っこに絞り込みボタンを
              配置してモーダルが出るように」というご要望を受け、絞り込みボタンを
              独立した箱から見出し(履歴一覧(N件))と同じ行の右端へ移動した。
              件数サマリ・リセットボタンは見出し行のすぐ下に小さく残し、
              絞り込み中は見出し行のボタンに件数バッジを表示する。 */}
          <div style={s.cardHeaderRow}>
            <h3 style={s.h3}>履歴一覧({incidents.length}件)</h3>
            <button
              style={s.filterCornerBtn}
              onClick={() => setFilterOpen(true)}
            >
              <span style={s.filterToggleChevron}>▸</span>
              絞り込み
              {isFilterActive && (
                <span style={s.filterActiveBadge}>{incidents.length}</span>
              )}
            </button>
          </div>
          <div style={s.filterSummaryRow}>
            <span style={s.filterSummary}>
              {allIncidents.length}件中 <strong>{incidents.length}件</strong>を表示中
            </span>
            <button style={s.resetBtn} onClick={resetAllFilters}>絞り込みをリセット</button>
          </div>

          {filterOpen && (
            <div style={s.filterModalOverlay} onClick={() => setFilterOpen(false)}>
              <div style={s.filterModalCard} onClick={(e) => e.stopPropagation()}>
                <div style={s.filterModalHeaderRow}>
                  <span style={s.filterModalTitle}>絞り込み</span>
                  <button style={s.filterModalCloseBtn} onClick={() => setFilterOpen(false)} aria-label="閉じる">✕</button>
                </div>
                <div style={s.filterModalBody}>
                  <div style={s.filterRow}>
                    <span style={s.filterRowLabel}>キーワード</span>
                    <input
                      type="text"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="発生内容で検索(例: 転倒、キッチン)"
                      style={s.searchInput}
                    />
                  </div>

                  <div style={s.filterRow}>
                    <span style={s.filterRowLabel}>期間</span>
                    <div style={s.filterTabs}>
                      {DATE_RANGES.map((r) => (
                        <button
                          key={r.key}
                          onClick={() => setDateRangeKey(r.key)}
                          style={{ ...s.filterTab, ...(dateRangeKey === r.key ? s.filterTabActive : {}) }}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={s.filterRow}>
                    <span style={s.filterRowLabel}>種類</span>
                    <div style={s.filterTabs}>
                      <button
                        onClick={selectAllCategories}
                        style={{ ...s.filterTab, ...(allSelected ? s.filterTabActive : {}) }}
                      >
                        すべて({allIncidents.length})
                      </button>
                      {GROUPS.map((g) => (
                        <button
                          key={g.key}
                          onClick={() => selectOnlyGroup(g.categories)}
                          style={{ ...s.filterTab, ...(isGroupActive(g.categories) ? s.filterTabActive : {}) }}
                          title={`${g.label}の履歴だけを表示`}
                        >
                          {g.label}のみ({groupCounts[g.key] || 0})
                        </button>
                      ))}
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.key}
                          onClick={() => toggleCategory(cat.key)}
                          style={{
                            ...s.filterTab,
                            ...(selectedCategories.has(cat.key) ? s.filterTabActive : s.filterTabOff),
                          }}
                        >
                          <span style={{ ...s.filterDot, background: cat.color }} />
                          {cat.label}({categoryCounts[cat.key] || 0})
                        </button>
                      ))}
                    </div>
                  </div>

                  {zoneList.length > 0 && (
                    <div style={s.filterRow}>
                      <span style={s.filterRowLabel}>エリア</span>
                      <div style={s.filterTabs}>
                        <button
                          onClick={selectAllAreas}
                          style={{ ...s.filterTab, ...(selectedAreaId === null ? s.filterTabActive : {}) }}
                        >
                          すべてのエリア({allIncidents.length})
                        </button>
                        {zoneList.map((zone) => (
                          <button
                            key={zone.id}
                            onClick={() => setSelectedAreaId(zone.id)}
                            style={{
                              ...s.filterTab,
                              ...(selectedAreaId === zone.id ? s.filterTabActive : {}),
                            }}
                            title={`「${zone.label}」の範囲内で発生した履歴だけを表示`}
                          >
                            <span style={{ ...s.filterDot, background: zone.type === 'danger' ? '#f43f5e' : '#f59e0b' }} />
                            {zone.label}({areaCounts[zone.id] || 0})
                          </button>
                        ))}
                        <button
                          onClick={() => setSelectedAreaId(OUTSIDE_AREA_ID)}
                          style={{
                            ...s.filterTab,
                            ...(selectedAreaId === OUTSIDE_AREA_ID ? s.filterTabActive : {}),
                          }}
                          title="どのエリアの範囲にも入っていない履歴だけを表示"
                        >
                          エリア外({areaCounts[OUTSIDE_AREA_ID] || 0})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div style={s.filterModalFooter}>
                  {/* resetBtnは元々filterBarHeader内(最後の要素)で使うためmarginLeft:'auto'
                      が付いているが、このフッターでは先頭に置くのでここだけ打ち消し、
                      代わりにfilterModalDoneBtn側のmarginLeft:'auto'で右寄せしている
                      (リセットは左、表示ボタンは右、という一般的なモーダルの配置)。 */}
                  <button style={{ ...s.resetBtn, marginLeft: 0 }} onClick={resetAllFilters}>絞り込みをリセット</button>
                  <button style={s.filterModalDoneBtn} onClick={() => setFilterOpen(false)}>
                    {incidents.length}件を表示
                  </button>
                </div>
              </div>
            </div>
          )}

          <p style={s.desc}>
            上の絞り込みバーで指定した条件に一致する履歴を、発生日時の新しい順に表示します。
          </p>
          <div style={s.list}>
            {incidents.length === 0 && (
              <p style={s.emptyNote}>
                該当する履歴はありません。
                <button style={s.linkBtn} onClick={resetAllFilters}>絞り込みをリセットする</button>
              </p>
            )}
            {incidents.map((inc) => (
              <div
                key={inc.id}
                style={{ ...s.row, ...(hoverId === inc.id ? s.rowHover : {}) }}
                onMouseEnter={() => setHoverId(inc.id)}
                onMouseLeave={() => setHoverId((h) => (h === inc.id ? null : h))}
              >
                <span style={{ ...s.rowDot, background: catColor[inc.category] || '#f43f5e' }} />
                <div style={s.rowBody}>
                  <div style={s.rowLabel}>
                    {inc.severity === 'danger' ? '⚠' : '△'} {catLabel[inc.category] || ''} — {inc.label}
                    {inc.approx && (
                      <span
                        style={s.approxBadge}
                        title="カメラキャリブレーション行列が未受領のため、位置は部屋の中心に概算表示しています"
                      >
                        位置は概算
                      </span>
                    )}
                  </div>
                  <div style={s.rowTime}>{formatDateTime(inc.time)}({formatRelative(inc.time, nowMs)})</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={s.card}>
          <div style={s.cardHeaderRow}>
            <h3 style={s.h3}>
              {mapMode === 'heatmap' ? 'ヒートマップ(間取り図)' : '3Dヒートマップ(発生場所別)'}
            </h3>
            {/* 「3Dで見れるように」の要望に対応する2D/3D切り替え。絞り込みバーで
                絞り込んだ結果(incidents)がどちらの表示にもそのまま反映される。 */}
            <div style={s.mapModeToggle}>
              <button
                onClick={() => setMapMode('heatmap')}
                style={{ ...s.mapModeBtn, ...(mapMode === 'heatmap' ? s.mapModeBtnActive : {}) }}
              >
                2Dヒートマップ
              </button>
              <button
                onClick={() => setMapMode('3d')}
                style={{ ...s.mapModeBtn, ...(mapMode === '3d' ? s.mapModeBtnActive : {}) }}
              >
                3D
              </button>
            </div>
          </div>

          <p style={s.desc}>
            {mapMode === 'heatmap' &&
              '色が濃い(赤みが強い)場所ほど、発生回数が多いエリアです。上の絞り込みバーで種類・エリア・期間・キーワードを指定すると、この地図にも即座に反映されます。'}
            {mapMode === '3d' &&
              '2Dヒートマップと同じ考え方で、色が濃い場所ほど発生回数が多いエリアです。ドラッグで自由に回転させて立体的に確認できます。'}
          </p>

          {mapMode === '3d' ? (
            <div style={s.chart3dWrap}>
              {/* 【2026-08-19further変更】「棒グラフは削除してヒートマップのみで
                  よい」というご要望を受け、3D表示は常にヒートマップ
                  (IncidentHeatmap3D)のみを表示する。resetKeyにincidents.lengthを
                  渡し、絞り込み条件が変わって再描画されるたびにエラー境界の
                  エラー状態もリセットされるようにしている(「3Dでヒートマップが
                  表示されない」という不具合報告への対応の一つ)。 */}
              <IncidentHeatmap3D incidents={incidents} resetKey={incidents.length} />
            </div>
          ) : (
          <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={s.svg}>
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={s.svgBg} />
            <polygon points={polygonPoints} fill={theme.mode === 'dark' ? '#161c28' : '#ffffff'} stroke={theme.borderSoft} strokeWidth={2} />

            {/* ヒートマップ(単色・不透明度による連続的なランプ=sequential配色) */}
            {heatCells.map((c, i) => {
              const { sx, sy } = roomToSvg(c.x, c.z);
              return (
                <rect
                  key={i}
                  x={sx - cellSizeSvg / 2}
                  y={sy - cellSizeSvg / 2}
                  width={cellSizeSvg}
                  height={cellSizeSvg}
                  fill="#ef4444"
                  opacity={Math.min(0.82, c.norm * 0.82)}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}

            {/* 危険/注意エリアの輪郭(参考として薄く表示) */}
            {(Array.isArray(zones) ? zones : []).map((zone) => {
              const tl = roomToSvg(zone.x - zone.width / 2, zone.z - zone.depth / 2);
              const br = roomToSvg(zone.x + zone.width / 2, zone.z + zone.depth / 2);
              return (
                <rect
                  key={zone.id}
                  x={tl.sx} y={tl.sy} width={br.sx - tl.sx} height={br.sy - tl.sy}
                  fill="none"
                  stroke={zone.type === 'danger' ? '#f43f5e' : '#f59e0b'}
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* 室内の間仕切り壁(参考として薄く表示) */}
            {(Array.isArray(walls) ? walls : []).map((w) => {
              const a = roomToSvg(w.x1, w.z1);
              const b = roomToSvg(w.x2, w.z2);
              return <line key={w.id} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={theme.borderSoft} strokeWidth={2} />;
            })}
            {edges.map(([a, b], i) => {
              const pa = roomToSvg(a.x, a.z);
              const pb = roomToSvg(b.x, b.z);
              return <line key={i} x1={pa.sx} y1={pa.sy} x2={pb.sx} y2={pb.sy} stroke={theme.borderSoft} strokeWidth={2.5} />;
            })}

            {/* 個別のインシデント位置(丸印。ホバーで詳細を表示)。
                位置が概算(approx)のものは、実際の発生位置ではなく部屋の中心である
                ことが一目でわかるよう、点線の輪と一回り大きいサイズで表示する。 */}
            {incidents.map((inc) => {
              const { sx, sy } = roomToSvg(inc.x, inc.z);
              const color = catColor[inc.category] || (inc.severity === 'danger' ? '#f43f5e' : '#f59e0b');
              const isHover = hoverId === inc.id;
              const titleText = `${catLabel[inc.category] || ''} — ${inc.label}\n${formatDateTime(inc.time)}` +
                (inc.approx ? '\n(※ 位置は概算です。カメラキャリブレーション行列が未受領のため部屋の中心に表示しています)' : '');
              return (
                <g key={inc.id}>
                  {inc.approx && (
                    <circle
                      cx={sx} cy={sy} r={isHover ? 11 : 9}
                      fill="none"
                      stroke={color}
                      strokeDasharray="3 2"
                      strokeWidth={1.25}
                      opacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <circle
                    cx={sx} cy={sy} r={isHover ? 6 : 4.5}
                    fill={color}
                    stroke={theme.mode === 'dark' ? '#0b0e14' : '#ffffff'}
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverId(inc.id)}
                    onMouseLeave={() => setHoverId((h) => (h === inc.id ? null : h))}
                  >
                    <title>{titleText}</title>
                  </circle>
                </g>
              );
            })}
          </svg>
          )}

          <div style={s.legendRow}>
            <span style={s.legendLabel}>発生密度</span>
            <span style={s.legendText}>少ない</span>
            <div style={s.legendGradient} />
            <span style={s.legendText}>多い</span>
            {CATEGORIES.map((cat) => (
              <React.Fragment key={cat.key}>
                <span style={s.legendDot(cat.color)} />
                <span style={s.legendText}>{cat.label}</span>
              </React.Fragment>
            ))}
          </div>
          {mapMode === 'heatmap' && incidents.some((i) => i.approx) && (
            <p style={s.approxNote}>
              点線の輪が付いたマーカーは、位置が概算(部屋の中心)であることを示します
              (カメラキャリブレーション行列が未受領のため。詳細はマーカーにカーソルを
              合わせるか、ROLE_C_SPEC_ALIGNMENT.mdを参照)。発生密度の計算にも含めていません。
            </p>
          )}
          {mapMode === '3d' && incidents.some((i) => i.approx) && (
            <p style={s.approxNote}>
              位置が概算(部屋の中心)の履歴は、発生密度の計算には含めていません
              (カメラキャリブレーション行列が未受領のため。詳細は
              ROLE_C_SPEC_ALIGNMENT.mdを参照)。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function makeStyles(theme, isMobile) {
  const svgBg = theme.mode === 'dark' ? '#0a0e16' : '#eef2f8';
  return {
    svgBg,
    page: { padding: isMobile ? '16px 14px 32px' : '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' },
    h2: { marginTop: 0, marginBottom: 6, color: theme.textStrong, fontSize: 22 },
    h3: { margin: '0 0 8px', fontSize: 15.5, color: theme.textStrong },
    lead: { color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5, marginBottom: 18 },
    dataSourceNote: {
      maxWidth: 1100, fontSize: 12, color: theme.warning, marginTop: -10, marginBottom: 18,
      lineHeight: 1.6,
    },
    dataSourceNoteOk: {
      maxWidth: 1100, fontSize: 12, color: theme.accent, marginTop: -10, marginBottom: 18,
      lineHeight: 1.6,
    },
    dataSourceNoteError: {
      maxWidth: 1100, fontSize: 12.5, fontWeight: 600, color: theme.danger, marginTop: -10, marginBottom: 18,
      lineHeight: 1.6,
    },
    // 【2026-08-19further変更】「件数などは1行に表示されるように」というご要望を
    // 受け、モバイル時は3枚のカードが折り返さず必ず1行に収まるよう、
    // flexWrapを止めてflex:1で均等割りし、paddingとフォントサイズも縮小した
    // (幅120pxのminWidthのままだと375px幅の画面では折り返してしまっていた)。
    statRow: { display: 'flex', gap: isMobile ? 8 : 14, marginBottom: 24, flexWrap: isMobile ? 'nowrap' : 'wrap' },
    statCard: {
      minWidth: isMobile ? 0 : 120, flex: isMobile ? '1 1 0' : '0 0 auto',
      padding: isMobile ? '10px 6px' : '12px 18px', borderRadius: 12, background: theme.panelBg,
      border: `1px solid ${theme.border}`, textAlign: 'center',
    },
    statNum: { fontSize: isMobile ? 20 : 26, fontWeight: 800, color: theme.textStrong, lineHeight: 1.2 },
    statLabel: { fontSize: isMobile ? 10.5 : 11.5, color: theme.textFaint, marginTop: 2, whiteSpace: 'nowrap' },
    grid: { display: 'flex', gap: isMobile ? 16 : 24, flexWrap: 'wrap', alignItems: 'flex-start' },
    // スマホ幅では固定580pxだと画面からはみ出すため、画面幅いっぱいに広げる
    // (2枚のカードは横並びをやめ、gridのflexWrapによって自然に縦積みになる)。
    // 【2026-08-19further変更・不具合修正】「カードがスマホ画面に収まっていない」
    // という報告への対応。width:'100%'に加えてpadding・borderも指定していたが、
    // boxSizing(既定はcontent-box)を指定していなかったため、実際の描画幅が
    // 「100%(画面幅いっぱい) + padding(左右28px) + border(左右2px)」分だけ
    // 画面より広がってしまい、横スクロールが発生していた。他ページ(LoginPage.jsx
    // 等)と同じくboxSizing:'border-box'を指定し、width指定にpadding・borderを
    // 含めて計算させることで画面幅にきちんと収まるようにする。
    card: {
      background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14,
      padding: isMobile ? 14 : 20, width: isMobile ? '100%' : 580, boxSizing: 'border-box',
    },
    listCard: { display: 'flex', flexDirection: 'column' },
    cardHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 },
    desc: { fontSize: 12, color: theme.textMuted, lineHeight: 1.6, marginBottom: 10 },
    // 【2026-08-19further2変更】「履歴一覧の右側の端っこに絞り込みボタンを配置して
    // ほしい」というご要望への対応。以前は独立した箱(filterBar)の中に絞り込み
    // ボタンを置いていたが、見出し(履歴一覧(N件))と同じ行の右端に置く、ボタンと
    // 分かりやすいピル型のボタンに変更した。
    filterCornerBtn: {
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
      color: theme.textStrong, background: theme.panelBgAlt, border: `1px solid ${theme.borderSoft}`,
      borderRadius: 8, cursor: 'pointer', padding: '7px 12px', flexShrink: 0,
    },
    // 絞り込み中(既定値から何か変わっている状態)であることをひと目で伝えるための
    // 小さな件数バッジ。
    filterActiveBadge: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18,
      padding: '0 5px', borderRadius: 999, background: theme.accent, color: '#fff', fontSize: 10.5,
      fontWeight: 800, lineHeight: 1,
    },
    filterToggleChevron: { display: 'inline-block', fontSize: 12, color: theme.textFaint, transition: 'transform 0.15s ease' },
    filterSummary: { fontSize: 12.5, color: theme.textMuted },
    // 見出し行の下に残す、件数サマリとリセットボタンの行(絞り込みボタン自体は
    // 見出し行の右端に移動したため、ここには軽い付随情報だけを残している)。
    filterSummaryRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
    resetBtn: {
      marginLeft: 'auto', fontSize: 12, color: theme.accent, background: 'transparent',
      border: `1px solid ${theme.accentBorder}`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer',
    },
    // 【2026-08-19further変更】「履歴一覧の絞り込みもモーダル化してほしい」という
    // ご要望への対応。InfoButton.jsx/NotificationModal.jsxと同じ「画面中央に
    // 表示する共通モーダル」の見た目・構造をそのまま踏襲している。
    // 【重要】このページは3Dヒートマップ(IncidentHeatmap3D.jsx)を持ち、3D表示
    // 全般で@react-three/dreiの<Html>ラベルが既定で非常に大きなzIndex
    // (zIndexRange既定値[16777271, 0])を自前で持つため、通常のzIndex:1000
    // のままだと3Dラベルがこのモーダルより手前に表示されてしまう
    // (NotificationModal.jsx/InfoButton.jsxと同じ原因・同じ対処)。
    filterModalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      zIndex: 100000000,
    },
    filterModalCard: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '80vh',
      background: theme.panelBgAlt,
      borderRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    },
    filterModalHeaderRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: `1px solid ${theme.border}`,
      flexShrink: 0,
    },
    filterModalTitle: { color: theme.textStrong, fontWeight: 700, fontSize: 15 },
    filterModalCloseBtn: {
      width: 28,
      height: 28,
      borderRadius: 8,
      border: 'none',
      background: 'transparent',
      color: theme.textMuted,
      fontSize: 16,
      cursor: 'pointer',
      flexShrink: 0,
    },
    filterModalBody: {
      padding: '4px 16px 16px',
      overflowY: 'auto',
    },
    filterModalFooter: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      borderTop: `1px solid ${theme.border}`,
      flexShrink: 0,
    },
    filterModalDoneBtn: {
      marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#fff', background: theme.accent,
      border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer',
    },
    filterRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 10 },
    filterRowLabel: {
      flexShrink: 0, width: 62, fontSize: 12, fontWeight: 700, color: theme.textFaint,
      marginTop: 8,
    },
    searchInput: {
      flex: 1, minWidth: 200, maxWidth: 420, fontSize: 13, padding: '8px 12px', borderRadius: 7,
      border: `1px solid ${theme.borderSoft}`, background: theme.panelBgAlt, color: theme.text,
    },
    mapModeToggle: { display: 'flex', gap: 4, flexShrink: 0 },
    mapModeBtn: {
      fontSize: 11.5, padding: '6px 10px', borderRadius: 7, border: `1px solid ${theme.borderSoft}`,
      background: 'transparent', color: theme.textMuted, cursor: 'pointer',
    },
    mapModeBtnActive: { background: theme.accentSoft, color: theme.accent, border: `1px solid ${theme.accentBorder}` },
    chart3dWrap: {
      width: '100%', height: SVG_H, borderRadius: 10, overflow: 'hidden',
      border: `1px solid ${theme.borderSoft}`, boxSizing: 'border-box',
    },
    filterTabs: { display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
    filterTab: {
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '7px 10px', borderRadius: 7,
      border: `1px solid ${theme.borderSoft}`, background: 'transparent', color: theme.textMuted, cursor: 'pointer',
    },
    filterTabActive: { background: theme.accentSoft, color: theme.accent, border: `1px solid ${theme.accentBorder}` },
    filterTabOff: { opacity: 0.5 },
    filterDot: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%' },
    linkBtn: {
      marginLeft: 8, fontSize: 12, color: theme.accent, background: 'transparent', border: 'none',
      textDecoration: 'underline', cursor: 'pointer', padding: 0,
    },
    svg: { background: svgBg, borderRadius: 10, width: '100%', height: 'auto' },
    legendRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap', fontSize: 11.5, color: theme.textMuted },
    legendLabel: { fontWeight: 700, color: theme.textMuted, marginRight: 4 },
    legendText: { fontSize: 11.5, color: theme.textFaint },
    legendGradient: {
      width: 90, height: 10, borderRadius: 5,
      background: 'linear-gradient(90deg, rgba(239,68,68,0.05), rgba(239,68,68,0.85))',
      border: `1px solid ${theme.borderSoft}`,
    },
    legendDot: (color) => ({
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginLeft: 10,
    }),
    approxNote: { fontSize: 11, color: theme.textFaint, marginTop: 10, lineHeight: 1.6 },
    list: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: 4 },
    emptyNote: { fontSize: 13, color: theme.textFaint },
    row: {
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`, background: theme.panelBgAlt,
    },
    rowHover: { border: `1px solid ${theme.accentBorder}`, background: theme.accentSoft },
    rowDot: { width: 9, height: 9, borderRadius: '50%', marginTop: 4, flexShrink: 0 },
    rowBody: { flex: 1, minWidth: 0 },
    rowLabel: { fontSize: 12.5, color: theme.text, fontWeight: 600, lineHeight: 1.5 },
    rowTime: { fontSize: 11, color: theme.textFaint, marginTop: 2 },
    approxBadge: {
      display: 'inline-block', marginLeft: 8, fontSize: 10, fontWeight: 700,
      color: theme.textFaint, border: `1px dashed ${theme.borderSoft}`, borderRadius: 999,
      padding: '1px 7px', verticalAlign: 'middle', cursor: 'help',
    },
  };
}
