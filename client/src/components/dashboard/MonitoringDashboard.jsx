import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBar from './StatusBar';
import NotificationPanel from './NotificationPanel';
import KeyLegendOverlay from './KeyLegendOverlay';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { footprintBounds, footprintCenter, footprintEdges } from '../../roomShapes';
import { isInsideZone } from '../../poseGeometry';
import { isPositionBlocked, resolveSafePosition } from '../../roomCollision';
import { THRESHOLDS } from '../../config';
import { useTheme } from '../../themeContext';
import { getIncidentsSortedDesc } from '../../incidentHistory';
import { fetchIncidentsSortedDesc } from '../../historyApi';

const DUMMY_STEP_M = 0.15; // 矢印キー1回あたりの移動量
let dummyIdSeq = 0;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 【重要】転倒検知・危険エリアへの接近・開閉センサーの通知など(useMonitoringAlerts)は、
// 以前はこのコンポーネント内で直接呼び出していたが、それだと見守りダッシュボードを
// 表示していない間(他の設定タブを見ている間)は検出・通知の評価そのものが止まって
// しまっていた(「今表示しているページだけをマウントする」というパフォーマンス対策の
// 副作用)。そのためApp.jsxのAppShell側(常時マウント)でuseMonitoringAlerts()を
// 呼び出し、その結果をpropsとしてこのコンポーネントへ渡す形にしている。
export default function MonitoringDashboard({
  connected,
  poseData,
  lastPoseAt,
  inputMode,
  shouldCapture,
  cameraError,
  requestWebcam,
  notifications,
  dismissNotification,
  acknowledgeNotification,
  clearAll,
  statusText,
  primaryPerson,
  isLost,
  personCount,
  allPersons,
  pushNotification,
}) {
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'pov'
  const { theme } = useTheme();
  const { footprint, zones, walls, furniture, roomShapeType } = useRoomConfig();

  // --------------------------------------------------------------
  // ヒートマップ表示(「見守りダッシュボードにもヒートマップを表示できる
  // ボタンがほしい」という要望への対応)。既定では非表示にしておき、
  // StatusBarの「ヒートマップ」ボタンを押したときだけ、危険行為の履歴に
  // 基づく発生密度ヒートマップを俯瞰3Dの床に重ねて表示する。
  // 計算・見た目は「危険行為の履歴」タブの3Dヒートマップ(HistoryPage.jsx /
  // IncidentHeatmap3D.jsx)と同じロジック(incidentHeatmap.js)を使う。
  // --------------------------------------------------------------
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapHistoryState, setHeatmapHistoryState] = useState(() => ({
    incidents: getIncidentsSortedDesc(),
    source: 'mock',
  }));
  useEffect(() => {
    let cancelled = false;
    fetchIncidentsSortedDesc().then((result) => {
      if (!cancelled) setHeatmapHistoryState(result);
    });
    return () => { cancelled = true; };
  }, []);
  const heatmapRoomCenter = useMemo(() => footprintCenter(footprint), [footprint]);
  // historyApi.js経由の実データは、位置(x, z)が不明な項目がx: null, z: nullで
  // 返ってくるため、HistoryPage.jsxと同じ方針で部屋の中心に概算配置しておく
  // (発生密度の計算(incidentHeatmap.js)自体はapprox:trueの項目を除外する)。
  const heatmapIncidents = useMemo(
    () => heatmapHistoryState.incidents.map((i) => (
      i.x === null || i.x === undefined || i.z === null || i.z === undefined
        ? { ...i, x: heatmapRoomCenter.x, z: heatmapRoomCenter.z, approx: true }
        : i
    )),
    [heatmapHistoryState.incidents, heatmapRoomCenter],
  );
  const toggleHeatmap = useCallback(() => setShowHeatmap((v) => !v), []);

  const hasPerson = !!primaryPerson && !isLost;
  const confidencePct = hasPerson ? Math.round(primaryPerson.avgConf * 100) : 0;
  const fallen = hasPerson && primaryPerson.aspectRatio < THRESHOLDS.FALL_ASPECT_RATIO;
  const colorState = fallen ? 'danger' : notifications.some((n) => n.level === 'danger' && Date.now() - n.time < 4000) ? 'warning' : 'normal';

  // --------------------------------------------------------------
  // ダミー人物(「ダミーを置く」ボタンで手動配置する仮の人物)。
  // 実際のYOLO検出が無い環境でも見守りモニターの人物表示・危険通知などを
  // 確認できるようにするための機能。矢印キーで選択中のダミーを移動できる
  // (部屋の外形の範囲内にクランプされる)。
  //
  // 【矢印キーでの移動 → 危険エリアへの接近の自動検知】
  // ダミーを矢印キーで動かして「家具・エリアの設定」タブで設定した危険/注意
  // エリアの矩形内に実際に入ると、実際のYOLO検出時と同じ仕組み(下の
  // dummyZoneMembership監視用useEffect参照)で自動的に危険通知が発生する。
  //
  // 【危険行為の模擬(数字キー1〜9)】
  // ダミーは実際のYOLO検出のようなポーズ(姿勢)情報を持たないため、転倒や
  // 誤飲のような「その場の姿勢・動作」から自動判定する行為は、位置だけからは
  // 判定できない。そのため、ダミーを選択した状態で数字キーを押すことで、
  // 見守りモニターの通知(危険通知パネル)へ直接その行為を模擬発生させる
  // 仕組みにしている(実際の検出通知と同じuseMonitoringAlerts().pushNotification
  // をそのまま使うため、通知パネルへの出方・クールダウン挙動も実検出と同じ)。
  //   1: 転倒
  //   2: 誤飲の恐れ
  //   3〜9: 「家具・エリアの設定」タブで設定されている危険/注意エリアへの接近
  //         (zones配列の1件目が3、2件目が4、…という対応。最大7エリア分)
  // --------------------------------------------------------------
  const [dummies, setDummies] = useState([]); // [{ id, x, z }]
  const [selectedDummyId, setSelectedDummyId] = useState(null);
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);

  // 「家具や壁にめり込ませないようにしてほしい」という要望への対応。
  // 【重要・不具合修正】以前は外壁(部屋の外形そのもの)が衝突判定の対象に
  // 含まれておらず、部屋の外形からの単純なクランプ(bounds.minX+0.15 など)
  // だけに頼っていたため、L字型など長方形以外の部屋では外壁の外側(部屋の
  // 形の外)にはみ出せてしまったり、外壁の余白がPERSON_RADIUS_M分の必要な
  // 厚みより狭く、壁にわずかにめり込んで見えることがあった。ここで部屋の
  // 外形(footprint)の各辺を壁として明示的に衝突判定に含めるようにする
  // (PlaceholderRoom.jsxが実際に描画する外壁の位置と完全に一致させるため、
  // 同じfootprintEdges()を使う)。室内の間仕切り壁(walls)は、それが実際に
  // 表示されるとき(roomShapeType==='custom')だけ追加で含める。
  const exteriorWalls = useMemo(
    () => footprintEdges(footprint).map(([a, b]) => ({ x1: a.x, z1: a.z, x2: b.x, z2: b.z })),
    [footprint]
  );
  const collisionWalls = useMemo(
    () => (roomShapeType === 'custom' ? [...exteriorWalls, ...(Array.isArray(walls) ? walls : [])] : exteriorWalls),
    [exteriorWalls, walls, roomShapeType]
  );

  // 直近で押された数字キー(1〜9)。KeyLegendOverlay側で該当行を一瞬だけ
  // ハイライトする「押した瞬間のフィードバック」用。flashTimerRefで前回分の
  // setTimeoutを覚えておき、連打された場合は毎回タイマーを張り直す。
  const [flashKey, setFlashKey] = useState(null);
  const flashTimerRef = useRef(null);
  const flashDummyKey = useCallback((key) => {
    setFlashKey(key);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashKey(null), 550);
  }, []);
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const addDummy = useCallback(() => {
    dummyIdSeq += 1;
    const id = `dummy-${dummyIdSeq}`;
    const center = footprintCenter(footprint);
    // 複数体置いたときに完全に重ならないよう、少しずつずらして配置する
    const offset = ((dummies.length % 5) - 2) * 0.4;
    const x = clamp(center.x + offset, bounds.minX + 0.2, bounds.maxX - 0.2);
    const z = clamp(center.z, bounds.minZ + 0.2, bounds.maxZ - 0.2);
    // 部屋の中心付近にちょうど家具が置かれている場合に備え、置いた瞬間から
    // 家具・壁にめり込んで見えないよう、必要なら安全な位置へ少しだけ押し出す。
    const safe = resolveSafePosition({ x, z }, { walls: collisionWalls, furniture });
    setDummies((prev) => [...prev, { id, x: safe.x, z: safe.z }]);
    setSelectedDummyId(id);
  }, [dummies.length, footprint, bounds, collisionWalls, furniture]);

  // ダミーごとに「現在どのエリアの中にいるか」を覚えておくための参照
  // (実検出のuseMonitoringAlerts.js内のactiveZonesと同じ「入った瞬間だけ通知する」
  // 考え方。エリアの中にいる間ずっと鳴り続けたり、置いた場所によっては何も
  // 起きないまま、という状態を避けるため)。
  const dummyZoneMembership = useRef({}); // { [dummyId]: Set<zoneId> }

  const clearDummies = useCallback(() => {
    setDummies([]);
    setSelectedDummyId(null);
    dummyZoneMembership.current = {};
  }, []);

  // ダミーが移動して危険/注意エリアに入ったら、実際のYOLO検出時と同じように
  // 自動で危険通知を発生させる(矢印キーでの移動に連動)。数字キー3〜9による
  // 「エリア接近の模擬」は押した瞬間に強制的に発生させるものだったが、これは
  // 実際にダミーの座標がエリアの矩形内に入ったかどうかで自動判定する点が異なる
  // (どちらも最終的にはuseMonitoringAlerts()のpushNotification経由で同じ通知
  // パネルに出るため、通知の出方・クールダウン挙動は共通)。
  useEffect(() => {
    const zoneList = Array.isArray(zones) ? zones : [];
    dummies.forEach((d) => {
      const membership = dummyZoneMembership.current[d.id] || new Set();
      zoneList.forEach((zone) => {
        const inside = isInsideZone({ x: d.x, z: d.z }, zone);
        const wasInside = membership.has(zone.id);
        if (inside && !wasInside) {
          pushNotification(`dummy_auto_zone_${d.id}_${zone.id}`, {
            title: '危険エリアに接近',
            message: `(ダミー操作) 「${zone.label.replace(/^危険[・･]?|^注意[・･]?/, '')}」に接近しました。`,
            level: zone.type === 'danger' ? 'danger' : 'warning',
          });
        }
        if (inside) membership.add(zone.id);
        else membership.delete(zone.id);
      });
      dummyZoneMembership.current[d.id] = membership;
    });
    // 削除済みダミーの記録は掃除しておく(メモリリーク防止・IDの使い回し対策)
    const liveIds = new Set(dummies.map((d) => d.id));
    Object.keys(dummyZoneMembership.current).forEach((id) => {
      if (!liveIds.has(id)) delete dummyZoneMembership.current[id];
    });
  }, [dummies, zones, pushNotification]);

  // 矢印キーで選択中のダミーを移動、数字キー(1〜9)で危険行為を模擬する。
  // どちらも「ダミーが選択されている」かつ「入力欄にフォーカスが無い」(他ページの
  // テキスト入力などと衝突しないよう)ときだけ有効にする。
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedDummyId) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        setDummies((prev) => prev.map((d) => {
          if (d.id !== selectedDummyId) return d;
          let { x, z } = d;
          if (e.key === 'ArrowUp') z -= DUMMY_STEP_M;
          if (e.key === 'ArrowDown') z += DUMMY_STEP_M;
          if (e.key === 'ArrowLeft') x -= DUMMY_STEP_M;
          if (e.key === 'ArrowRight') x += DUMMY_STEP_M;
          const next = { x: clamp(x, bounds.minX + 0.15, bounds.maxX - 0.15), z: clamp(z, bounds.minZ + 0.15, bounds.maxZ - 0.15) };
          // 家具や壁(外壁・間仕切り壁の両方)と重なる移動先には進めないようにする
          // (以前は外壁が判定に含まれておらず、footprintの範囲内であれば家具・壁を
          // 無視してすり抜けて移動できてしまっていた)。collisionWallsには常に外壁を、
          // 間仕切り壁は実際に表示されているとき(roomShapeType==='custom')だけ含めている。
          if (isPositionBlocked(next, { walls: collisionWalls, furniture, includeWalls: true })) {
            return d;
          }
          return { ...d, ...next };
        }));
        return;
      }

      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        flashDummyKey(e.key);
        if (e.key === '1') {
          pushNotification('dummy_fall', {
            title: '転倒検知',
            message: '(ダミー操作) 転倒を検知しました。至急ご確認ください。',
            level: 'danger',
          });
        } else if (e.key === '2') {
          pushNotification('dummy_ingestion', {
            title: '誤飲の恐れ',
            message: '(ダミー操作) 小物を口に運ぶ動作を検知しました。',
            level: 'warning',
          });
        } else {
          // 3〜9: zones配列のN件目(N = 押したキー - 3)への接近を模擬する。
          // 「家具・エリアの設定」タブで追加したエリアもそのまま4〜9キーの
          // 対象になる(最大7エリア分)。対応するエリアが無いキーは何もしない。
          const zoneIndex = Number(e.key) - 3;
          const zone = Array.isArray(zones) ? zones[zoneIndex] : undefined;
          if (zone) {
            pushNotification(`dummy_zone_${zone.id}`, {
              title: '危険エリアに接近',
              message: `(ダミー操作) 「${zone.label.replace(/^危険[・･]?|^注意[・･]?/, '')}」に接近しました。`,
              level: zone.type === 'danger' ? 'danger' : 'warning',
            });
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // 【修正】以前はwalls/furniture/collisionWallsが依存配列に無く、それらの値が
    // 変わってもこのuseEffect内のクロージャが古い値を参照し続けてしまっていた
    // (「部屋の設定」「家具・エリアの設定」タブで変更した直後は反映されないバグ)。
  }, [selectedDummyId, bounds, zones, pushNotification, flashDummyKey, collisionWalls, furniture]);

  // 見守りシーンに表示する人物一覧(検出された全員分)。主対象(先頭の1人)には
  // 通知と連動した色を、それ以外には控えめな標準色を割り当てる。
  // 【重要】実際のYOLO検出座標(p.floor)そのものは書き換えず、resolveSafePosition()で
  // 「表示位置だけ」を家具・壁にめり込まないよう僅かに押し出す(危険エリア判定などは
  // 元の座標(primaryPerson/useMonitoringAlerts側)のまま使われるため、判定結果には影響しない)。
  const people = isLost
    ? []
    : allPersons.map((p, idx) => ({
        id: idx,
        floor: resolveSafePosition(p.floor, { walls: collisionWalls, furniture }),
        fallen: p.aspectRatio < THRESHOLDS.FALL_ASPECT_RATIO,
        colorState: idx === 0 ? colorState : 'normal',
      }));

  // ダミー人物も見守りシーンに重ねて表示する(実検出とは紫色で見分けられる)。
  // クリックすると、そのダミーを矢印キーでの移動対象として選択できる。
  const dummyPeople = dummies.map((d) => ({
    id: d.id,
    floor: { x: d.x, z: d.z },
    fallen: false,
    dummy: true,
    selected: d.id === selectedDummyId,
    onSelect: () => setSelectedDummyId(d.id),
  }));

  const styles = useMemo(() => ({
    page: { display: 'flex', flexDirection: 'column', height: '100%', background: theme.appBg },
    body: { flex: 1, display: 'flex', minHeight: 0 },
    sceneWrap: { flex: 1, position: 'relative' },
  }), [theme]);

  // 数字キー(1〜9)と危険行為の対応表(現在のzones設定に応じて動的に生成する)。
  // KeyLegendOverlay(見守りシーン上に常時表示するパネル)とStatusBarの
  // ツールチップの両方で、この同じ一覧を元に表示する(表示先が2箇所になった
  // ため、一覧はここで1度だけ作り、それぞれの表示形式に変換する)。
  const keyLegendItems = useMemo(() => {
    const items = [
      { key: '1', label: '転倒' },
      { key: '2', label: '誤飲の恐れ' },
    ];
    (Array.isArray(zones) ? zones : []).slice(0, 7).forEach((zone, i) => {
      items.push({ key: String(i + 3), label: `「${zone.label}」への接近` });
    });
    return items;
  }, [zones]);

  // StatusBarのツールチップ(title属性)用に、上の一覧を改行区切りの文字列へ変換する。
  const dummyKeyHelp = useMemo(() => (
    ['選択中のダミーに、キーボードで危険行為を模擬発生させられます:']
      .concat(keyLegendItems.map((item) => `${item.key}: ${item.label}`))
      .join('\n')
  ), [keyLegendItems]);

  return (
    <div style={styles.page}>
      <StatusBar
        connected={connected}
        hasPerson={hasPerson}
        confidencePct={confidencePct}
        personCount={personCount}
        statusText={isLost ? '検出待ち' : statusText}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        inputMode={inputMode}
        shouldCapture={shouldCapture}
        cameraError={cameraError}
        requestWebcam={requestWebcam}
        dummyCount={dummies.length}
        onAddDummy={addDummy}
        onClearDummies={clearDummies}
        dummyKeyHelp={dummyKeyHelp}
        heatmapOn={showHeatmap}
        onToggleHeatmap={toggleHeatmap}
      />
      <div style={styles.body}>
        <div style={styles.sceneWrap}>
          <RoomScene
            viewMode={viewMode}
            people={[...people, ...dummyPeople]}
            showHeatmap={showHeatmap}
            heatmapIncidents={heatmapIncidents}
          />
          {selectedDummyId && <KeyLegendOverlay items={keyLegendItems} flashKey={flashKey} />}
        </div>
        <NotificationPanel
          notifications={notifications}
          onAck={acknowledgeNotification}
          onDismiss={dismissNotification}
          onClearAll={clearAll}
        />
      </div>
    </div>
  );
}
