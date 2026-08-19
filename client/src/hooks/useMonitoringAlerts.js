import { useEffect, useRef, useState, useCallback } from 'react';
import { analyzePerson, floorDistance, isInsideZone, imageToFloor } from '../poseGeometry';
import { THRESHOLDS } from '../config';
import { useRoomConfig } from '../roomConfigContext';

let notifSeq = 0;
function nextId() {
  notifSeq += 1;
  return `n${Date.now()}_${notifSeq}`;
}

// 本番環境モードでの「一時的な人物マーカー」の最大表示時間(ms)。
// 仕様書(Role A/Role C)のJSONスキーマには継続的な姿勢(pose)ストリームが
// 存在せず、ai_hazardイベントは「その瞬間に何かが起きた」という単発の
// 通知のため、検出時と同じように「歩き続ける3Dアバター」を出し続けることは
// できない。そこでユーザーと相談の上、次の2つの表示終了条件を両方備えることにした。
//   1. 対応する危険通知が「確認(✓)」または「削除(✕)」されたら、その場で消える。
//   2. 上記の操作が無くても、この時間が経過したら自動的に消える
//      (通知を放置していても、いつまでも部屋の中に人型が居座らないようにするため)。
const HAZARD_MARKER_LIFETIME_MS = 15000;

/**
 * 見守りダッシュボード用の状態管理フック。
 * pose-dataの推移を監視して、
 *   ・カメラの範囲からの消失
 *   ・長時間静止
 *   ・転倒検知
 *   ・危険エリアへの侵入
 * を検出し、動画のUIのような通知リストを生成する。
 */
export function useMonitoringAlerts(poseData, lastPoseAt, connected, iotMessage) {
  const { footprint, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraResolution, zones, doorSensors } = useRoomConfig();
  const [notifications, setNotifications] = useState([]);
  const [statusText, setStatusText] = useState('待機中');
  const [primaryPerson, setPrimaryPerson] = useState(null);
  const [isLost, setIsLost] = useState(false);
  const [personCount, setPersonCount] = useState(0);
  const [allPersons, setAllPersons] = useState([]);
  // 本番環境モードで、AWS IoT Coreから受信したai_hazardイベント(details.x/y、
  // 画像上のピクセル座標)をもとに一時的に表示する人型マーカー。
  // [{ id, notifId, floor:{x,z}, fallen, createdAt }, ...]
  const [hazardMarkers, setHazardMarkers] = useState([]);

  // 通知の連続発生を防ぐためのクールダウン管理
  const lastFiredAt = useRef({}); // { [key]: timestamp }
  const stationaryStartFloor = useRef(null);
  const stationaryStartTime = useRef(null);
  const wasFallen = useRef(false);
  const activeZones = useRef(new Set());
  const wasVisible = useRef(false);
  const lostFiredAt = useRef(0);
  const lastKnownPositionRef = useRef({ x: null, z: null, time: 0 });
  const personStatesRef = useRef({}); // { personIndex: state }
  const iotPoseRef = useRef({ keypoints: null, localTime: 0 }); // 本番環境での最新姿勢データ保持用

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
  // 【不具合修正】以前はcameraPitchDeg・cameraFovDegがここに含まれておらず、
  // analyzePerson()(→imageToFloor())に渡るroomConfigに上下角度・視野角が
  // 一切入っていなかった。そのため「カメラ位置の設定」タブで上下角度(pitch)や
  // 視野角(FOV)を実際のカメラに合わせて調整しても、検出処理は常にconfig.jsの
  // 既定値(CAMERA_PITCH_DEG・CAMERA_FOV_DEG)を使い続けてしまい、「設定した
  // カメラの向きと、実際に人物が表示される位置がズレる」不具合の原因になって
  // いた(向き(yaw)自体は反映されるが、上下角度・視野角の設定が無視される
  // ため、特に上下角度がずれるほど検出位置の誤差が大きくなる)。
  const roomConfigRef = useRef({ footprint, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraResolution });
  const zonesRef = useRef(zones);
  useEffect(() => { poseDataRef.current = poseData; }, [poseData]);
  useEffect(() => { lastPoseAtRef.current = lastPoseAt; }, [lastPoseAt]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => {
    roomConfigRef.current = { footprint, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraResolution };
  }, [footprint, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraResolution]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);

  // 【重要】戻り値として、実際に通知が発生した場合のみそのidを返す
  // (クールダウン中で通知が発生しなかった場合はnullを返す)。ai_hazardイベントの
  // 一時的な人物マーカー(hazardMarkers)は、この戻り値のidを使って対応する
  // 通知と紐付けており、通知が「確認」または「削除」されたときに連動して
  // マーカーも消せるようにしている(下のaddHazardMarker/通知監視effect参照)。
  const pushNotification = useCallback((key, { title, message, level }) => {
    const now = Date.now();
    const last = lastFiredAt.current[key] || 0;
    if (now - last < THRESHOLDS.NOTIFY_COOLDOWN_MS) return null;
    lastFiredAt.current[key] = now;

    const id = nextId();
    setNotifications((prev) => {
      const item = {
        id,
        key,
        title,
        message,
        level, // 'danger' | 'warning'
        time: now,
        acknowledged: false,
      };
      return [item, ...prev].slice(0, 30);
    });
    return id;
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const acknowledgeNotification = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, acknowledged: true } : n)));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  // 本番環境モードのai_hazardイベント用: 通知と同時に、そのイベントが起きた
  // 場所(details.x/y。画像上のピクセル座標)を部屋のフロア座標に変換し、
  // 一時的な人型マーカー(PersonFigureを再利用)として表示する。
  // notifIdがnull(通知自体がクールダウンで抑制された)の場合は、対応する
  // 通知が存在せずマーカーだけが残ってしまうのを避けるため、マーカーも作らない。
  const addHazardMarker = useCallback((notifId, details, fallen, precalculatedFloor = null) => {
    if (!notifId) return;
    
    let floor = precalculatedFloor;
    if (!floor) {
      if (details == null || details.x == null || details.y == null) return;
      // 画像上の座標が人物の中心であると仮定し、姿勢に応じて投影先の高さを変える
      // (床面Y=0にそのまま投影すると、レイが奥に伸びすぎて実際の立ち位置より遠くに表示されてしまうため)
      const targetY = fallen ? 0.2 : 1.0;
      floor = imageToFloor(details.x, details.y, roomConfigRef.current, targetY);
    }
    
    if (!floor || !Number.isFinite(floor.x) || !Number.isFinite(floor.z)) return;
    const markerId = `hazard_${notifId}`;
    setHazardMarkers((prev) => [...prev, { id: markerId, notifId, floor, fallen, createdAt: Date.now() }].slice(-20));
  }, []);

  // AWS IoT Core からのリアルタイム通知 (MQTT) を監視し、
  // システム共通JSONスキーマに従って通知パネルへポップアップさせる。
  useEffect(() => {
    if (!iotMessage || !iotMessage.data) return;

    const { event_type, details, timestamp } = iotMessage.data;
    // 重複通知を防ぐため、メッセージのタイムスタンプをキーに含める
    const msgKey = `${event_type}_${timestamp}`;

    if (event_type === 'ai_hazard' || event_type === 'normal') {
      let hazardType = details.hazard_type || 'none';
      let precalculatedFloor = null;

      // 【不具合修正】エッジ側からの誤判定(顔面アップ時の横長バウンディングボックスによる転倒判定)を
      // フロントエンド側で再検証して弾く。また、足元基準の正確な3D座標を算出する。
      let isFalsePositive = false;
      const eventTime = timestamp || Date.now();

      // --- 速度チェック ---
      if (details.x != null && details.y != null) {
        const targetY = hazardType === 'fall' || hazardType === 'prone' ? 0.2 : 1.0;
        precalculatedFloor = imageToFloor(details.x, details.y, roomConfigRef.current, targetY);

        if (precalculatedFloor) {
          const lastPos = lastKnownPositionRef.current;
          if (lastPos.time > 0) {
            // イベントのタイムスタンプを使って正確な経過時間を計算
            const dt = (eventTime - lastPos.time) / 1000;
            // dtが小さすぎる場合（ネットワーク遅延等による同時到達）はノイズ判定をスキップ
            if (dt > 0.1 && dt < 5.0) { 
              const dx = precalculatedFloor.x - lastPos.x;
              const dz = precalculatedFloor.z - lastPos.z;
              const dist = Math.sqrt(dx * dx + dz * dz);
              const speed = dist / dt;
              if (speed > 4.0) { // 4m/s以上の移動はワープとして棄却
                isFalsePositive = true;
              }
            }
          }
        }
      }

      if (details.keypoints && Array.isArray(details.keypoints)) {
        const person = analyzePerson(details.keypoints, roomConfigRef.current);
        if (person) {
          precalculatedFloor = person.floor; // より正確な足元座標で上書き
        }

        if (hazardType === 'fall') {
          const validKpts = details.keypoints.filter(k => k && k[2] > 0.5);
          
          // 有効なキーポイントが少なすぎる場合は誤検知とみなす
          if (validKpts.length < 3) {
            isFalsePositive = true;
          } else {
            const getKpt = (idx) => details.keypoints[idx] && details.keypoints[idx][2] > 0.5 ? details.keypoints[idx] : null;
            // 5:l_shoulder, 6:r_shoulder
            const shoulders = [getKpt(5), getKpt(6)].filter(Boolean);
            // 13:l_knee, 14:r_knee, 15:l_ankle, 16:r_ankle
            const legs = [getKpt(13), getKpt(14), getKpt(15), getKpt(16)].filter(Boolean);

            // 体の一部しか見えていない（肩も脚も見えない）場合は棄却
            if (shoulders.length === 0 && legs.length === 0) {
              isFalsePositive = true;
            } else if (shoulders.length > 0 && legs.length > 0) {
              // 転倒の幾何学的チェック
              const avgShoulderY = shoulders.reduce((sum, k) => sum + k[1], 0) / shoulders.length;
              const avgLegY = legs.reduce((sum, k) => sum + k[1], 0) / legs.length;
              const avgShoulderX = shoulders.reduce((sum, k) => sum + k[0], 0) / shoulders.length;
              const avgLegX = legs.reduce((sum, k) => sum + k[0], 0) / legs.length;

              const height = Math.abs(avgLegY - avgShoulderY);
              const width = Math.abs(avgLegX - avgShoulderX);

              // 幅より高さの方が大きい（立っている状態に近い）場合は棄却
              if (height > width * 1.5) {
                isFalsePositive = true;
              }
            } else if (person && !person.hasLowerBody) {
              // 下半身が見えていないのに転倒と判定されている場合は誤検知として無視する
              isFalsePositive = true;
            }
          }
        }
      }

      if (isFalsePositive) {
        return;
      }

      if (precalculatedFloor) {
        lastKnownPositionRef.current = { x: precalculatedFloor.x, z: precalculatedFloor.z, time: eventTime };
      }

      // 本番環境での3Dモデル表示用に最新のキーポイントを保存
      if (details.keypoints && Array.isArray(details.keypoints)) {
        iotPoseRef.current = { keypoints: details.keypoints, localTime: Date.now() };
      }

      if (event_type === 'normal') {
        return; // normalの場合は通知やマーカー追加は行わない
      }

      // 【本番環境: 一時的な人物マーカー】仕様書には継続的な姿勢ストリームが
      // 無いため、デモ用データのような「歩き続ける3Dアバター」の代わりに、
      // ai_hazardイベントが届いた瞬間の場所へ、人型のマーカーを数秒だけ表示する
      // (転倒/うつ伏せ寝は倒れた姿勢、危険エリア侵入は立った姿勢で表示)。
      if (hazardType === 'fall') {
        const notifId = pushNotification(`iot_fall_${msgKey}`, {
          title: '転倒検知 (クラウドAI)',
          message: '転倒を検知しました。至急ご確認ください。',
          level: 'danger',
        });
        addHazardMarker(notifId, details, true, precalculatedFloor);
      } else if (hazardType === 'prone') {
        const notifId = pushNotification(`iot_prone_${msgKey}`, {
          title: 'うつ伏せ寝検知 (クラウドAI)',
          message: 'うつ伏せ寝を検知しました。呼吸状態にご注意ください。',
          level: 'danger',
        });
        addHazardMarker(notifId, details, true, precalculatedFloor);
      } else if (hazardType === 'intrusion') {
        const notifId = pushNotification(`iot_intrusion_${msgKey}`, {
          title: '危険エリア侵入 (クラウドAI)',
          message: '危険エリアへの侵入を検知しました。',
          level: 'danger',
        });
        addHazardMarker(notifId, details, false, precalculatedFloor);
      }
    } else if (event_type === 'sensor_alert') {
      if (details.sensor_type === 'door') {
        const statusText = details.status === 'open' ? '開きました' : '閉まりました';
        pushNotification(`iot_door_${details.status}_${msgKey}`, {
          title: `ドアセンサーが${statusText}`,
          message: `ドアが${statusText} (バッテリー: ${details.battery_level}%)`,
          level: 'warning',
        });
      }
    } else if (event_type === 'complex_alert') {
      if (details.alert_type === 'night_wandering') {
        pushNotification(`iot_night_wandering_${msgKey}`, {
          title: '夜間徘徊の疑い',
          message: `夜間徘徊の疑いを検知しました (きっかけ: ${details.trigger_device}, 照度: ${details.lux}lux)`,
          level: 'danger',
        });
      }
    } else if (event_type === 'risk_suggestion') {
      const reasonText = details.reason === 'unusual_access_time' ? '普段行かない場所へのアクセス' : details.reason;
      pushNotification(`iot_risk_${msgKey}`, {
        title: '潜在的リスクのサジェスト',
        message: `AIによるリスクサジェスト: ${reasonText}`,
        level: details.risk_level === 'high' ? 'danger' : 'warning',
      });
    }
  }, [iotMessage, pushNotification, addHazardMarker]);

  // 一時的な人物マーカー(hazardMarkers)の表示終了処理。
  // ・対応する通知(notifId)が「確認(✓)」または「削除(✕)」されたら、その場で
  //   マーカーも消す(通知一覧から無くなった、またはacknowledged:trueになった)。
  // ・上記の操作が無くても、HAZARD_MARKER_LIFETIME_MSが経過したマーカーは
  //   1秒おきのチェックで自動的に消す(通知を放置していても、いつまでも
  //   部屋の中に人型が居座らないようにするため)。
  useEffect(() => {
    if (hazardMarkers.length === 0) return undefined;
    const notifMap = new Map(notifications.map((n) => [n.id, n]));
    setHazardMarkers((prev) => {
      const now = Date.now();
      const next = prev.filter((m) => {
        const notif = notifMap.get(m.notifId);
        const notifGone = !notif || notif.acknowledged;
        const expired = now - m.createdAt > HAZARD_MARKER_LIFETIME_MS;
        return !notifGone && !expired;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [notifications, hazardMarkers.length]);

  // 通知一覧の変化だけでは、通知にも操作にも触れないまま最大表示時間を
  // 過ぎたマーカー(=誰も確認/削除しなかった場合)を消すきっかけが無いため、
  // 1秒ごとに期限切れのマーカーが無いか確認する。
  useEffect(() => {
    if (hazardMarkers.length === 0) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setHazardMarkers((prev) => {
        const next = prev.filter((m) => now - m.createdAt <= HAZARD_MARKER_LIFETIME_MS);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hazardMarkers.length]);

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
      let poseData = poseDataRef.current;
      let lastPoseAt = lastPoseAtRef.current;
      const connected = connectedRef.current;
      let isIotPose = false;

      // 本番環境（poseDataがnull）の場合、IoTから受信した最新の姿勢データを使用する
      if (!poseData && iotPoseRef.current.localTime > 0) {
        poseData = { keypoints: [iotPoseRef.current.keypoints] };
        lastPoseAt = iotPoseRef.current.localTime;
        isIotPose = true;
      }

      // --- 1. カメラの範囲からの消失 判定 ---
      // 1秒おきのデータ送信に対応するため、IoT経由の場合はタイムアウトを3000msに延長する
      const timeoutMs = isIotPose ? 3000 : THRESHOLDS.LOST_TIMEOUT_MS;
      const noRecentPose = !lastPoseAt || now - lastPoseAt > timeoutMs;
      const roomConfig = roomConfigRef.current;
      const persons = poseData && Array.isArray(poseData.keypoints)
        ? poseData.keypoints.map((kpts, idx) => {
            const prevState = personStatesRef.current[idx] || null;
            const person = analyzePerson(kpts, roomConfig, prevState);
            if (person) {
              personStatesRef.current[idx] = person.state;
            }
            return person;
          }).filter(Boolean)
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
        personStatesRef.current = {}; // 誰もいなくなったら学習状態と平滑化をリセット
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
      // アスペクト比が横長であることに加え、下半身が見えていることを条件とする。
      // (上半身のみが写っている場合、顔や肩の幅で横長判定されてしまう誤検知を防ぐため)
      // ただし、極端に横長(0.3未満)の場合は下半身が隠れていても転倒とみなす。
      const isFallenRatio = person.aspectRatio < THRESHOLDS.FALL_ASPECT_RATIO;
      const fallen = isFallenRatio && (person.hasLowerBody || person.aspectRatio < 0.3);
      
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
    // 本番環境モードで、ai_hazardイベントの発生場所へ数秒だけ表示する
    // 一時的な人物マーカー(MonitoringDashboard.jsx側でRoomSceneのpeopleに合流させる)。
    hazardMarkers,
    // 「ダミーを置く」機能から、実際のYOLO検出を介さずに危険行為の通知を
    // 手動で発生させる(MonitoringDashboard.jsxの数字キー操作)ために公開する。
    // 実検出の通知(転倒・危険エリア侵入など)と同じ仕組み(クールダウン・
    // 通知パネルへの追加)をそのまま再利用できる。
    pushNotification,
  };
}