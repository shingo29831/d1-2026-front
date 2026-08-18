// ===================================================================
// 危険行為の履歴を取得する。
// 【Role C仕様書 Step 5「履歴API(JWTトークン付き)からのデータ取得」との対応】
//
// 【重要】このファイルが解釈するJSONの形は、チームの仕様書サイト
// (https://d1-docs.pages.dev/ 、詳細は role_a.html / role_b.html / role_c.html)
// で確認した「システム共通JSONスキーマ」に厳密に合わせている
// (以前は実際のフィールド名が不明だったため複数候補を試す寛容な実装にしていたが、
// 仕様書で下記3パターンが確定したため、正確なパーサーに置き換えた)。
//
//   共通の外側の形:
//     { device_id, room_id, timestamp(エポックミリ秒), event_type, details }
//   event_type別のdetails:
//     "ai_hazard"     : { hazard_type: "fall"|"prone"|"intrusion", x, y(画像上のピクセル座標), confidence }
//     "sensor_alert"  : { sensor_type: "door"|"temperature", status, battery_level }
//     "complex_alert" : { alert_type: "night_wandering", trigger_device, lux }
//
// 【重要・設計判断】
// ・"sensor_alert"は sensor_type==="door" かつ status==="open"(ドアが開いた)の
//   ときだけ履歴として扱う。temperature(気温)は「危険行為」ではないため対象外。
// ・仕様書のhazard_type一覧(fall/prone/intrusion)には「誤飲」は含まれていない。
//   以前追加した「誤飲」カテゴリはサンプル(モック)データの表示・絞り込み用として
//   incidentHistory.js にはそのまま残すが、実際のAPIレスポンスの解釈はこの
//   仕様書の値だけに厳密に従う(=実データから「誤飲」が生成されることは無い)。
//
// client/.env の VITE_HISTORY_API_URL が設定されていれば、そのURLへ
// Cognito IDトークン付きでfetchし、レスポンスを取得する。
// URLが未設定、通信エラー、認証エラー、レスポンスの形式が想定と異なる場合は、
// いずれも例外を投げずに incidentHistory.js の直書きサンプルデータへ自動的に
// フォールバックする(履歴画面が真っ白になったりエラーで固まったりしないように
// するため)。
//
// 呼び出し側(HistoryPage.jsx)は戻り値の `source` ('api' | 'mock') と
// `error` を見て、画面上に「実データ / サンプルデータのどちらを表示しているか」
// を小さく案内する想定。
import { getIdToken } from './authToken';
import { getIncidentsSortedDesc as getMockIncidentsSortedDesc } from './incidentHistory';
import { imageToFloor } from './poseGeometry';

const HISTORY_API_URL = import.meta.env.VITE_HISTORY_API_URL || '';

// hazard_type → このアプリ内部のカテゴリ/重大度/メッセージへの対応表。
// (incidentHistory.js の CATEGORIES に同じキー(fall/prone/intrusion)を定義済み)
const HAZARD_TYPE_MAP = {
  fall: { category: 'fall', severity: 'danger', label: '転倒を検知しました' },
  prone: { category: 'prone', severity: 'danger', label: 'うつ伏せ寝を検知しました' },
  intrusion: { category: 'intrusion', severity: 'danger', label: '危険エリアへの侵入を検知しました(AIによる自動検知)' },
};

function getLocalRoomConfig() {
  try {
    const saved = localStorage.getItem('d1_room_config');
    if (saved) return JSON.parse(saved);
  } catch (e) {
    // ignore
  }
  return null;
}

function normalizeAiHazardDetails(details, roomConfig) {
  const map = HAZARD_TYPE_MAP[details && details.hazard_type];
  if (!map) return null; // 仕様書に無いhazard_typeが来た場合は無視する
  const confPct = typeof details.confidence === 'number' ? Math.round(details.confidence * 100) : null;

  let x = null;
  let z = null;
  let approx = true;

  // カメラの設置情報(roomConfig)を用いて、画像上のピクセル座標を3D空間の床面座標に変換する
  if (details.x != null && details.y != null && roomConfig) {
    // 画像上の座標が人物の中心であると仮定し、姿勢に応じて投影先の高さを変えることで精度を高める
    // 転倒・うつ伏せは床に近い(0.2m)、侵入は立っている状態の中心(1.0m)と仮定
    const targetY = (details.hazard_type === 'fall' || details.hazard_type === 'prone') ? 0.2 : 1.0;
    const floor = imageToFloor(details.x, details.y, roomConfig, targetY);
    if (floor && Number.isFinite(floor.x) && Number.isFinite(floor.z)) {
      x = floor.x;
      z = floor.z;
      approx = false;
    }
  }

  return {
    type: map.category,
    category: map.category,
    severity: map.severity,
    label: confPct !== null ? `${map.label}(確信度${confPct}%)` : map.label,
    x,
    z,
    approx,
  };
}

function normalizeSensorAlertDetails(details) {
  if (!details || details.sensor_type !== 'door' || details.status !== 'open') {
    // ドアが「開いた」イベントだけを履歴として扱う。気温等は危険行為ではないため対象外。
    return null;
  }
  return {
    type: 'door_open',
    category: 'door_open',
    severity: 'warning',
    label: 'ドアが開いたことを検知しました',
    x: null,
    z: null,
    approx: true,
  };
}

function normalizeComplexAlertDetails(details) {
  if (!details || details.alert_type !== 'night_wandering') return null;
  const luxNote = typeof details.lux === 'number' ? `、照度${details.lux}lux` : '';
  return {
    type: 'night_wandering',
    category: 'night_wandering',
    severity: 'danger',
    label: `夜間徘徊の疑いを検知しました${details.trigger_device ? `(きっかけ: ${details.trigger_device}${luxNote})` : ''}`,
    x: null,
    z: null,
    approx: true,
  };
}

function normalizeRiskSuggestionDetails(details) {
  if (!details || !details.suggested_area) return null;
  const reasonText = details.reason === 'unusual_access_time' ? '普段行かない場所へのアクセス' : details.reason;
  return {
    type: 'risk_suggestion',
    category: 'risk_suggestion',
    severity: details.risk_level === 'high' ? 'danger' : 'warning',
    label: `潜在的リスク: ${reasonText}`,
    rawX: details.suggested_area.x,
    rawY: details.suggested_area.y,
    radius: details.suggested_area.radius,
    x: null,
    z: null,
    approx: true,
  };
}

// APIレスポンスの1件(仕様書の共通JSONスキーマ)を、このアプリの内部形式
// { id, type, category, severity, label, x, z, time, approx, deviceId, roomId } に変換する。
// 対応していないevent_type/hazard_type等の場合はnullを返し、その1件だけ無視する。
function normalizeIncident(raw, index, roomConfig) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.event_type || raw.timestamp === undefined || raw.timestamp === null) return null;

  let base = null;
  if (raw.event_type === 'ai_hazard') base = normalizeAiHazardDetails(raw.details, roomConfig);
  else if (raw.event_type === 'sensor_alert') base = normalizeSensorAlertDetails(raw.details);
  else if (raw.event_type === 'complex_alert') base = normalizeComplexAlertDetails(raw.details);
  else if (raw.event_type === 'risk_suggestion') base = normalizeRiskSuggestionDetails(raw.details);

  if (!base) return null;

  const timeMs = Number(raw.timestamp);
  if (Number.isNaN(timeMs)) return null;
  const time = new Date(timeMs).toISOString();

  return {
    id: `api-${raw.device_id || 'unknown'}-${raw.timestamp}-${index}`,
    ...base,
    time,
    deviceId: raw.device_id || null,
    roomId: raw.room_id || null,
  };
}

function extractList(data) {
  // Role Bのモック実装(Lambda)はJSON配列をそのままレスポンスボディにする
  // (API Gateway Lambdaプロキシ統合)。念のため、よくある他の包み方にも対応しておく。
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.incidents)) return data.incidents;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
  }
  return null;
}

// 履歴データを取得する。戻り値: { incidents, source: 'api'|'mock'|'error', error: string|null }
//
// 【重要・本番環境モードでの挙動】opts.isProductionがtrueのとき(ハンバーガー
// メニューの「本番環境」モード)は、取得に失敗しても`incidentHistory.js`の
// サンプルデータへ自動フォールバックしない。以前はデモ用データモードと同じ
// ロジックを共有しており、本番環境で履歴APIへの疎通が切れていても画面には
// 「もっともらしい」サンプルデータがそのまま表示され続け、実際にはデータを
// 取得できていないことに気づきにくいという問題があった(お客様からのご指摘)。
// 本番環境では、取得できなかった場合は source: 'error' ・ incidents: [] を返し、
// 呼び出し側(HistoryPage.jsx等)で「取得できませんでした」と明確に表示する。
//
// 【重要・デモ用データモードでの挙動】opts.isProductionがfalse(デモ用データ
// モード)のときは、VITE_HISTORY_API_URLが設定されているかどうかに関わらず、
// 実際のAWS履歴APIへは一切通信せず、常にincidentHistory.js内のこの端末で
// 自由に追加・編集・削除できるデータ(getEditableIncidents()と同じ内容)を返す。
// 以前は履歴APIが設定されていると、デモ用データモードでも実データへ問い合わせて
// しまい、画面(危険行為の履歴・見守りダッシュボードのAIリスクサジェスト表示等)に
// 編集内容ではなく実データが表示されてしまう不具合があった。実データへの通信が
// 発生するのは本番環境モードのときだけ。
// 実際のAWS履歴API(VITE_HISTORY_API_URL)へ問い合わせる共通処理。
// 成功時は { incidents, source: 'api', error: null } を返す。
// 失敗時(URL未設定・通信エラー・タイムアウト・レスポンス形式異常・0件)は
// { incidents: [], source: 'error', error: message } を返す(例外は投げない)。
// 【重要】この関数自体はデモ/本番モードを一切見ない、実データへの問い合わせのみを
// 行う低レベル処理。呼び出し側(fetchIncidentsSortedDesc / checkHistoryApiConnectivity)
// が、いつこれを呼ぶかを判断する。
async function fetchRealIncidentsFromApi(roomConfig) {
  if (!HISTORY_API_URL) {
    return {
      incidents: [],
      source: 'error',
      error: '履歴API(VITE_HISTORY_API_URLの環境変数)が設定されていません。',
    };
  }

  // 【重要】fetch()には既定でタイムアウトが無いため、API側やネットワーク経路が
  // 応答無しのまま固まってしまうと、このPromiseはいつまでも決着しない。
  // AbortControllerで10秒の上限を設け、超えたら明示的にリクエストを中断する
  // (呼び出し側=HistoryPage.jsx/ConnectionStatusPage.jsxが「読み込み中」の
  // まま永久に固まって見える事態を防ぐため)。
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const token = await getIdToken();

    // Role BのDynamoDBクエリ(GSI)に必要な必須パラメータを付与
    const url = new URL(HISTORY_API_URL);
    url.searchParams.append('room_id', 'living_room');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`APIがエラーを返しました(HTTP ${res.status})`);
    }
    const data = await res.json();
    const rawList = extractList(data);
    if (!rawList) {
      throw new Error('APIレスポンスの形式が想定と異なります(配列が見つかりません)');
    }
    const incidents = rawList
      .map((raw, i) => normalizeIncident(raw, i, roomConfig))
      .filter(Boolean)
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    if (incidents.length === 0) {
      throw new Error('APIレスポンスから有効な履歴データを読み取れませんでした');
    }
    return { incidents, source: 'api', error: null };
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    const message = isTimeout
      ? 'APIの応答がありませんでした(10秒でタイムアウトしました)。ネットワーク環境(社内ネットワーク/VPN等の制限)をご確認ください。'
      : (err && err.message ? err.message : String(err));
    return { incidents: [], source: 'error', error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchIncidentsSortedDesc(opts = {}) {
  const isProduction = !!opts.isProduction;
  const roomConfig = opts.roomConfig || getLocalRoomConfig();

  // 【重要・バグ修正】以前は、デモ用データモードであってもVITE_HISTORY_API_URLが
  // 設定されていれば実際のAWS履歴APIへ問い合わせてしまい、「デモ用データモードでは
  // 画面から自由に追加・編集・削除できるようにしてほしい」というご要望に反して、
  // ダッシュボードのAIリスクサジェスト表示や危険行為の履歴・ヒートマップが、
  // ユーザーが編集した内容ではなく実データ(Role Bの履歴API)で上書きされてしまう
  // 不具合があった(本番環境モードでない限り、実データへは一切問い合わせない、
  // という区別が徹底されていなかった)。
  // デモ用データモードでは、履歴APIが設定されているかどうかに関わらず、常に
  // incidentHistory.js内のこの端末で編集可能なデータをそのまま使う(実データへは
  // 一切通信しない)。実データへの通信は本番環境モードのときのみ行う。
  if (!isProduction) {
    return { incidents: getMockIncidentsSortedDesc(), source: 'mock', error: null };
  }

  const result = await fetchRealIncidentsFromApi(roomConfig);
  if (result.source === 'error') {
    // 【重要】本番環境モードではサンプルデータへフォールバックしない
    // (このファイル冒頭のコメント参照)。
    // eslint-disable-next-line no-console
    console.warn('[historyApi] (本番環境モード)履歴APIの取得に失敗しました。サンプルデータへはフォールバックしません:', result.error);
    if (result.error && result.error.startsWith('履歴API(')) {
      return { ...result, error: `本番環境モードですが、${result.error}` };
    }
  }
  return result;
}

// 「接続状況」診断ページ(ConnectionStatusPage.jsx)専用。
// 【重要】この関数は、現在デモ用データモードか本番環境モードかに関わらず、
// 常に実際のAWS履歴APIへの疎通を試みる。ConnectionStatusPageの目的は
// 「AWSと実際に通信できているか」を確認することであり、デモ用データモードの
// ときに画面(危険行為の履歴等)へ実データを表示しない(fetchIncidentsSortedDesc
// 参照)こととは別の関心事のため、あえてfetchIncidentsSortedDescは使わず、
// この専用関数を用意している。
export async function checkHistoryApiConnectivity() {
  return fetchRealIncidentsFromApi(getLocalRoomConfig());
}