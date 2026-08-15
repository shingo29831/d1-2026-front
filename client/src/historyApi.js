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
// ・"ai_hazard"のx,yは画像上のピクセル座標であり、間取り図(床座標 x,z メートル)への
//   変換にはRole A提供のカメラキャリブレーション行列(内部/外部パラメータ)が必要だが、
//   まだ受領できていない。そのため、この時点ではx,zは確定できず null で返し、
//   呼び出し側(HistoryPage.jsx)が「部屋の中心に概算配置し、位置は概算と明記する」
//   という運用で表示する(ROLE_C_SPEC_ALIGNMENT.md参照)。
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

const HISTORY_API_URL = import.meta.env.VITE_HISTORY_API_URL || '';

// hazard_type → このアプリ内部のカテゴリ/重大度/メッセージへの対応表。
// (incidentHistory.js の CATEGORIES に同じキー(fall/prone/intrusion)を定義済み)
const HAZARD_TYPE_MAP = {
  fall: { category: 'fall', severity: 'danger', label: '転倒を検知しました' },
  prone: { category: 'prone', severity: 'danger', label: 'うつ伏せ寝を検知しました' },
  intrusion: { category: 'intrusion', severity: 'danger', label: '危険エリアへの侵入を検知しました(AIによる自動検知)' },
};

function normalizeAiHazardDetails(details) {
  const map = HAZARD_TYPE_MAP[details && details.hazard_type];
  if (!map) return null; // 仕様書に無いhazard_typeが来た場合は無視する
  const confPct = typeof details.confidence === 'number' ? Math.round(details.confidence * 100) : null;
  return {
    type: map.category,
    category: map.category,
    severity: map.severity,
    label: confPct !== null ? `${map.label}(確信度${confPct}%)` : map.label,
    // 画像上のピクセル座標(details.x, details.y)は間取り図の床座標に変換できない
    // (カメラキャリブレーション行列が未受領のため)。呼び出し側で部屋の中心に
    // 概算配置してもらうため、ここでは位置未確定としてnullを返す。
    x: null,
    z: null,
    approx: true,
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

// APIレスポンスの1件(仕様書の共通JSONスキーマ)を、このアプリの内部形式
// { id, type, category, severity, label, x, z, time, approx, deviceId, roomId } に変換する。
// 対応していないevent_type/hazard_type等の場合はnullを返し、その1件だけ無視する。
function normalizeIncident(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.event_type || raw.timestamp === undefined || raw.timestamp === null) return null;

  let base = null;
  if (raw.event_type === 'ai_hazard') base = normalizeAiHazardDetails(raw.details);
  else if (raw.event_type === 'sensor_alert') base = normalizeSensorAlertDetails(raw.details);
  else if (raw.event_type === 'complex_alert') base = normalizeComplexAlertDetails(raw.details);

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

// 履歴データを取得する。戻り値: { incidents, source: 'api'|'mock', error: string|null }
// incidents内の各項目は、床座標(x, z)が不明なもの(現状の"ai_hazard"等すべて)は
// x: null, z: null, approx: true になっている。実際の間取りに配置する処理は
// HistoryPage.jsx側(部屋の中心へフォールバック)に委ねる。
export async function fetchIncidentsSortedDesc() {
  if (!HISTORY_API_URL) {
    return { incidents: getMockIncidentsSortedDesc(), source: 'mock', error: null };
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
    const res = await fetch(HISTORY_API_URL, {
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
      .map((raw, i) => normalizeIncident(raw, i))
      .filter(Boolean)
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    if (incidents.length === 0) {
      throw new Error('APIレスポンスから有効な履歴データを読み取れませんでした');
    }
    return { incidents, source: 'api', error: null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[historyApi] 履歴APIの取得に失敗したため、サンプルデータで代替します:', err);
    const isTimeout = err && err.name === 'AbortError';
    return {
      incidents: getMockIncidentsSortedDesc(),
      source: 'mock',
      error: isTimeout
        ? 'APIの応答がありませんでした(10秒でタイムアウトしました)。ネットワーク環境(社内ネットワーク/VPN等の制限)をご確認ください。'
        : (err && err.message ? err.message : String(err)),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
