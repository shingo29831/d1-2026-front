import { useEffect, useRef, useState, useCallback } from 'react';
import { analyzePerson, floorDistance, isInsideZone } from '../poseGeometry';
import { THRESHOLDS } from '../config';
import { useRoomConfig } from '../roomConfigContext';

let notifSeq = 0;
function nextId() {
  notifSeq += 1;
  return `n${Date.now()}_${notifSeq}`;
}

/**
 * 見守りダッシュボード用の状態管理フック。
 * pose-dataの推移を監視して、
 *   ・カメラの範囲からの消失
 *   ・長時間静止
 *   ・転倒検知
 *   ・危険エリアへの侵入
 * を検出し、動画のUIのような通知リストを生成する。
 */
export function useMonitoringAlerts(poseData, lastPoseAt, connected) {
  const { footprint, cameraMount, cameraYawDeg, zones, doorSensors } = useRoomConfig();
  const [notifications, setNotifications] = useState([]);
  const [statusText, setStatusText] = useState('待機中');
  const [primaryPerson, setPrimaryPerson] = useState(null);
  const [isLost, setIsLost] = useState(false);
  const [personCount, setPersonCount] = useState(0);
  const [allPersons, setAllPersons] = useState([]);

  // 通知の連続発生を防ぐためのクールダウン管理
  const lastFiredAt = useRef({}); // { [key]: timestamp }
  const stationaryStartFloor = useRef(null);
  const stationaryStartTime = useRef(null);
  const wasFallen = useRef(false);
  const activeZones = useRef(new Set());
  const wasVisible = useRef(false);
  const lostFiredAt = useRef(0);

  // 【重要】poseData/lastPoseAt/connectedは毎フレーム(検出間隔によっては300msより
  // 短い周期で)新しい値になるため、下の評価用setIntervalの依存配列に直接含めると、
  // 評価が1度も実行されないうちにeffectが再生成され続けてしまい(clearInterval→
  // 再setIntervalの繰り返し)、検出人数や通知が永久に更新されなくなるバグがあった。
  // そのためrefに最新値を保持し、intervalは1度だけ生成して常にrefから読む。
  const poseDataRef = useRef(poseData);
  const lastPoseAtRef = useRef(lastPoseAt);
  const connectedRef = useRef(connected);
  // 「部屋の設定」「カメラ位置の設定」「家具・エリアの設定」タブで変更した内容も
  // 同様にrefで持ち、intervalを再生成せずに常に最新の設定でフロア座標や
  // 危険エリア判定を計算できるようにする。
  const roomConfigRef = useRef({ footprint, cameraMount, cameraYawDeg });
  const zonesRef = useRef(zones);
  useEffect(() => { poseDataRef.current = poseData; }, [poseData]);
  useEffect(() => { lastPoseAtRef.current = lastPoseAt; }, [lastPoseAt]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { roomConfigRef.current = { footprint, cameraMount, cameraYawDeg }; }, [footprint, cameraMount, cameraYawDeg]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);

  const pushNotification = useCallback((key, { title, message, level }) => {
    const now = Date.now();
    const last = lastFiredAt.current[key] || 0;
    if (now - last < THRESHOLDS.NOTIFY_COOLDOWN_MS) return;
    lastFiredAt.current[key] = now;

    setNotifications((prev) => {
      const item = {
        id: nextId(),
        key,
        title,
        message,
        level, // 'danger' | 'warning'
        time: now,
        acknowledged: false,
      };
      return [item, ...prev].slice(0, 30);
    });
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const acknowledgeNotification = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, acknowledged: true } : n)));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  // 開閉センサーの状態が変わるたびに通知を発生させる
  // (「開閉センサーの設定」タブの状態切り替えボタン、または将来の実センサー
  // イベント連携のどちらで状態が変わった場合でも、この監視だけで通知できる)。
  // 以前は「閉→開」のときだけ通知していたが、それだと例えば「玄関を通って外に
  // 出て、ドアが閉まった」というような、開閉センサーを実際に「通った」一連の
  // 動作の後半(閉まったこと)が通知されず、通り抜けたこと自体に気付けない
  // ケースがあった。そのため「開→閉」に戻ったときも別の通知として発生させ、
  // ドアの開閉(=通過)を確実に検知できるようにしている。
  // 【重要】開/閉それぞれ別のクールダウンキー(door_open_/door_closed_)を
  // 使っているため、短時間に開→閉→開…と連続して通り抜けても、開の通知と
  // 閉の通知はお互いに影響されず、どちらも都度発生する
  // (同じ方向への遷移が8秒以内に連続した場合のみ、通知の連発を防ぐために
  // 間引かれる。THRESHOLDS.NOTIFY_COOLDOWN_MS参照)。
  // 【重要】このフックはAppShell(App.jsx)側で常時呼び出しているため、見守り
  // ダッシュボードを表示していない間(他の設定タブを見ている間)に開閉センサーの
  // 状態が変わっても、この監視自体は止まらずに通知を発生させられる
  // (以前は見守りダッシュボード側でこのフックを呼んでいたため、ダッシュボードを
  // 表示していないと通知の判定自体が止まってしまっていた)。
  const doorSensorPrevStatus = useRef({});
  useEffect(() => {
    const list = Array.isArray(doorSensors) ? doorSensors : [];
    list.forEach((sensor) => {
      const prevStatus = doorSensorPrevStatus.current[sensor.id];
      if (prevStatus === 'closed' && sensor.status === 'open') {
        pushNotification(`door_open_${sensor.id}`, {
          title: '開閉センサーが開きました',
          message: `「${sensor.label || '開閉センサー'}」が開いたことを検知しました。`,
          level: 'warning',
        });
      } else if (prevStatus === 'open' && sensor.status === 'closed') {
        pushNotification(`door_closed_${sensor.id}`, {
          title: '開閉センサーが閉まりました',
          message: `「${sensor.label || '開閉センサー'}」が閉まったことを検知しました(通過の可能性があります)。`,
          level: 'warning',
        });
      }
      doorSensorPrevStatus.current[sensor.id] = sensor.status;
    });
    // 削除済みセンサーの記録は掃除しておく(メモリリーク防止・IDの使い回し対策)
    const liveIds = new Set(list.map((s) => s.id));
    Object.keys(doorSensorPrevStatus.current).forEach((id) => {
      if (!liveIds.has(id)) delete doorSensorPrevStatus.current[id];
    });
  }, [doorSensors, pushNotification]);

  // 定期的(300ms)に最新のpose-dataを評価する
  useEffect(() => {
    const evalInterval = setInterval(() => {
      const now = Date.now();
      const poseData = poseDataRef.current;
      const lastPoseAt = lastPoseAtRef.current;
      const connected = connectedRef.current;

      // --- 1. カメラの範囲からの消失 判定 ---
      const noRecentPose = !lastPoseAt || now - lastPoseAt > THRESHOLDS.LOST_TIMEOUT_MS;
      const roomConfig = roomConfigRef.current;
      const persons = poseData && Array.isArray(poseData.keypoints)
        ? poseData.keypoints.map((kpts) => analyzePerson(kpts, roomConfig)).filter(Boolean)
        : [];
      const hasPerson = connected && !noRecentPose && persons.length > 0;

      if (!hasPerson) {
        if (wasVisible.current && now - lostFiredAt.current > THRESHOLDS.NOTIFY_COOLDOWN_MS) {
          pushNotification('lost', {
            title: 'カメラの範囲からの消失',
            message: 'カメラの視界内から人物を監視できなくなりました。',
            level: 'danger',
          });
          lostFiredAt.current = now;
        }
        wasVisible.current = false;
        setIsLost(true);
        setPrimaryPerson(null);
        setPersonCount(0);
        setAllPersons([]);
        setStatusText(connected ? '検出待ち' : 'サーバー未接続');
        stationaryStartFloor.current = null;
        stationaryStartTime.current = null;
        return;
      }

      wasVisible.current = true;
      setIsLost(false);
      setPersonCount(persons.length);
      setAllPersons(persons);

      // 複数人検出時は、直近と最も近い(=主対象とみなす)1人を選ぶ。ここでは単純に先頭を採用。
      const person = persons[0];
      setPrimaryPerson(person);

      // --- 2. 転倒検知 ---
      const fallen = person.aspectRatio < THRESHOLDS.FALL_ASPECT_RATIO;
      if (fallen && !wasFallen.current) {
        pushNotification('fall', {
          title: '転倒検知',
          message: '転倒を警告しました。至急ご確認ください。',
          level: 'danger',
        });
      }
      wasFallen.current = fallen;

      // --- 3. 長時間静止 ---
      if (stationaryStartFloor.current === null) {
        stationaryStartFloor.current = person.floor;
        stationaryStartTime.current = now;
      } else {
        const moved = floorDistance(person.floor, stationaryStartFloor.current) > THRESHOLDS.STATIONARY_DISTANCE_M;
        if (moved) {
          stationaryStartFloor.current = person.floor;
          stationaryStartTime.current = now;
        } else if (now - stationaryStartTime.current > THRESHOLDS.STATIONARY_TIME_MS) {
          pushNotification('stationary', {
            title: '長時間静止',
            message: `${Math.round(THRESHOLDS.STATIONARY_TIME_MS / 1000)}秒以上、動きが検出されません。`,
            level: 'warning',
          });
          // 連続で鳴らし続けないよう基準時刻を更新
          stationaryStartTime.current = now;
        }
      }

      // --- 4. 危険エリアへの侵入 ---
      const zones = Array.isArray(zonesRef.current) ? zonesRef.current : [];
      zones.forEach((zone) => {
        const inside = isInsideZone(person.floor, zone);
        const wasInside = activeZones.current.has(zone.id);
        if (inside && !wasInside) {
          pushNotification(`zone_${zone.id}`, {
            title: '危険エリアへの侵入',
            message: `「${zone.label.replace(/^危険[・･]?|^注意\//, '')}」に侵入しました。`,
            level: zone.type === 'danger' ? 'danger' : 'warning',
          });
        }
        if (inside) activeZones.current.add(zone.id);
        else activeZones.current.delete(zone.id);
      });

      // --- ステータステキストの更新 ---
      if (fallen) {
        setStatusText('転倒後、床に倒れて静止中');
      } else if (now - stationaryStartTime.current < 500) {
        setStatusText('移動中');
      } else if (now - stationaryStartTime.current > THRESHOLDS.STATIONARY_TIME_MS) {
        setStatusText('アイドル(静止立位)');
      } else {
        setStatusText('検出中');
      }
    }, 300);

    return () => clearInterval(evalInterval);
    // poseData/lastPoseAt/connectedは上のrefで参照するため、意図的に依存配列から外している
    // (effectを1度だけ生成し、以後は常に最新のrefを読む。理由は上のコメント参照)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushNotification]);

  return {
    notifications,
    dismissNotification,
    acknowledgeNotification,
    clearAll,
    statusText,
    primaryPerson,
    isLost,
    personCount,
    allPersons,
    // 「ダミーを置く」機能から、実際のYOLO検出を介さずに危険行為の通知を
    // 手動で発生させる(MonitoringDashboard.jsxの数字キー操作)ために公開する。
    // 実検出の通知(転倒・危険エリア侵入など)と同じ仕組み(クールダウン・
    // 通知パネルへの追加)をそのまま再利用できる。
    pushNotification,
  };
}
