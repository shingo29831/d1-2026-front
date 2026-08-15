import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBar from './StatusBar';
import NotificationPanel from './NotificationPanel';
import KeyLegendOverlay from './KeyLegendOverlay';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { footprintBounds, footprintCenter } from '../../roomShapes';
import { isInsideZone } from '../../poseGeometry';
import { isPositionBlocked } from '../../roomCollision';
import { THRESHOLDS } from '../../config';
import { useTheme } from '../../themeContext';

const DUMMY_STEP_M = 0.15; // 矢印キー1回あたりの移動量
let dummyIdSeq = 0;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 【重要】転倒検知・危険エリア侵入・開閉センサーの通知など(useMonitoringAlerts)は、
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
  // 【矢印キーでの移動 → 危険エリア侵入の自動検知】
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
  //   3〜9: 「家具・エリアの設定」タブで設定されている危険/注意エリアへの侵入
  //         (zones配列の1件目が3、2件目が4、…という対応。最大7エリア分)
  // --------------------------------------------------------------
  const [dummies, setDummies] = useState([]); // [{ id, x, z }]
  const [selectedDummyId, setSelectedDummyId] = useState(null);
  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);

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
    setDummies((prev) => [...prev, { id, x, z }]);
    setSelectedDummyId(id);
  }, [dummies.length, footprint, bounds]);

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
  // 「エリア侵入の模擬」は押した瞬間に強制的に発生させるものだったが、これは
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
            title: '危険エリアへの侵入',
            message: `(ダミー操作) 「${zone.label.replace(/^危険[・･]?|^注意[・･]?/, '')}」に侵入しました。`,
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
          // 家具や壁と重なる移動先には進めないようにする(以前はfootprintの範囲内
          // であれば家具・壁を無視してすり抜けて移動できてしまっていた)。
          // 間仕切り壁は「部屋の設定」で既定の間取り(自由な多角形)を使っている
          // ときだけ判定に含める(PlaceholderRoom.jsxの表示条件と合わせている)。
          if (isPositionBlocked(next, { walls, furniture, includeWalls: roomShapeType === 'custom' })) {
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
          // 3〜9: zones配列のN件目(N = 押したキー - 3)への侵入を模擬する。
          // 「家具・エリアの設定」タブで追加したエリアもそのまま4〜9キーの
          // 対象になる(最大7エリア分)。対応するエリアが無いキーは何もしない。
          const zoneIndex = Number(e.key) - 3;
          const zone = Array.isArray(zones) ? zones[zoneIndex] : undefined;
          if (zone) {
            pushNotification(`dummy_zone_${zone.id}`, {
              title: '危険エリアへの侵入',
              message: `(ダミー操作) 「${zone.label.replace(/^危険[・･]?|^注意[・･]?/, '')}」に侵入しました。`,
              level: zone.type === 'danger' ? 'danger' : 'warning',
            });
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDummyId, bounds, zones, pushNotification, flashDummyKey]);

  // 見守りシーンに表示する人物一覧(検出された全員分)。主対象(先頭の1人)には
  // 通知と連動した色を、それ以外には控えめな標準色を割り当てる。
  const people = isLost
    ? []
    : allPersons.map((p, idx) => ({
        id: idx,
        floor: p.floor,
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
      items.push({ key: String(i + 3), label: `「${zone.label}」への侵入` });
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
      />
      <div style={styles.body}>
        <div style={styles.sceneWrap}>
          <RoomScene viewMode={viewMode} people={[...people, ...dummyPeople]} />
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
