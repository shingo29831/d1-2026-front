// ===================================================================
// 転倒検知・危険エリアへの接近の履歴(直書きのサンプルデータ)。
//
// 【Role C仕様書 Step 5との対応】仕様書ではRole Bの履歴取得API(モック→本番)
// からJSONを取得する想定(ROLE_C_SPEC_ALIGNMENT.md参照)。このファイルは
// そのAPIレスポンスの受け皿を直書きデータで代替している。本番化する際は、
// `getIncidentsSortedDesc()`の中身をAPI(JWTトークン付きfetch)呼び出しに
// 置き換える想定。
//
// 実運用では検出パイプライン(useMonitoringAlerts.js)が生成する通知や、
// 実際の履歴API(historyApi.js、仕様書のJSONスキーマに準拠)を蓄積していく
// 想定だが、このファイルはオフライン/API未接続時のフォールバック用サンプル
// として、実際の間取り(config.jsのROOM_FOOTPRINT/DEFAULT_ZONES)に合わせた
// もっともらしい座標・日時のサンプルを直接書いている。
//
// 各項目:
//   id       : 一意なID
//   type     : 危険行為の種類。仕様書(https://d1-docs.pages.dev/)のhazard_type
//              に対応する 'fall'(転倒) | 'prone'(うつ伏せ寝) | 'intrusion'(AIによる
//              エリアへの接近検知)、sensor_type/alert_typeに対応する 'door_open'
//              (ドアの開閉) | 'night_wandering'(夜間徘徊)に加え、このアプリ独自の
//              'zone'(家具・エリアの設定タブのエリアへの接近) | 'ingestion'(誤飲。
//              仕様書には無い、デモ用の拡張カテゴリ)がある
//   category : 危険行為の種類(下のCATEGORIES参照)。ヒートマップ/一覧の
//              「個別の危険行為」表示の絞り込みに使う。
//   severity : 'danger' (赤・危険) | 'warning' (橙・注意)
//   label    : 通知メッセージ相当の短い説明
//   x, z     : 発生位置(部屋のフロア座標系、メートル。原点は建物中央)。
//              historyApi.js経由の実データの場合、位置が不明(概算)なことがある
//              (HistoryPage.jsxのapproxフラグ参照)が、このサンプルデータは
//              すべて手入力の確定座標のため概算フラグは付かない。
//   time     : 発生日時(ISO 8601)
// ===================================================================

// 危険行為の種類ごとの表示名・色。「すべて」を選ぶと全種類を重ねて表示し、
// 個別に選ぶとその種類だけのヒートマップ・一覧に絞り込める。
//
// 【仕様書(https://d1-docs.pages.dev/ role_c.html等)のJSONスキーマとの対応】
// fall/prone/intrusion(AI推論アラートのhazard_type)、door_open(Merakiセンサー
// アラートのsensor_type="door"かつstatus="open")、night_wandering(複合アラート
// のalert_type)は、仕様書に定義された値にそのまま対応させている
// (historyApi.js が実際のAPIレスポンスをこれらのカテゴリに変換する)。
// 一方 zone_stairs/zone_kitchen/zone_genkan(「家具・エリアの設定」タブの
// エリアに対するこのアプリ独自のクライアント側判定)と ingestion(誤飲。
// 仕様書のhazard_type一覧には無い)は、このリポジトリのモック/デモ機能として
// 追加したものであり、実際のAPI/MQTTデータからは生成されない
// (=サンプルデータの表示・絞り込み確認用。ROLE_C_SPEC_ALIGNMENT.md参照)。
// 【重要】以前は「◯◯侵入」という表現を使っていたが、「攻撃・襲来のように
// 物々しく聞こえて、子供の見守りにはそぐわない」との指摘を受けて、より
// 自然な「◯◯に接近」という言い回しに統一した(危険/注意エリアに近づいた、
// という事実をそのまま伝える表現)。
export const CATEGORIES = [
  { key: 'fall', label: '転倒検知', color: '#f43f5e' },
  { key: 'prone', label: 'うつ伏せ寝', color: '#e11d48' },
  { key: 'zone_stairs', label: '階段(UP)に接近', color: '#f43f5e' },
  { key: 'zone_kitchen', label: 'キッチンに接近', color: '#f59e0b' },
  { key: 'zone_genkan', label: '玄関の段差に接近', color: '#f59e0b' },
  { key: 'intrusion', label: 'エリアへの接近(AI検知)', color: '#fb7185' },
  { key: 'ingestion', label: '誤飲の恐れ', color: '#eab308' },
  { key: 'door_open', label: 'ドアの開閉', color: '#38bdf8' },
  { key: 'night_wandering', label: '夜間徘徊の疑い', color: '#8b5cf6' },
  // 【重要】仕様書の共通JSONスキーマ(risk_suggestion)に対応するカテゴリ。
  // 以前はこのサンプルデータ側のCATEGORIESに無く、実データ(historyApi.js)
  // だけがrisk_suggestionを扱えていた。デモ用データモードでも同じ種類の
  // データを追加・編集できるようにするため追加した(IncidentDataEditorPage.jsx参照)。
  { key: 'risk_suggestion', label: 'AIリスクサジェスト', color: '#a855f7' },
];

// 「危険行為の履歴」画面の右側(履歴一覧)に置く、状態ごとのクイックフィルター。
// 転倒・誤飲・危険エリアへの接近など、細かいcategoryをまたいだ「大まかな状態」単位で
// 一発で絞り込めるようにするためのグルーピング(CATEGORIESは詳細な内訳用、
// GROUPSはその内訳をまとめた大分類用、という関係)。
// 「危険エリアへの接近」には、このアプリ独自のzone_*(家具・エリアの設定タブの
// エリア判定)と、仕様書のintrusion(AIによる汎用のエリアへの接近検知)の両方を
// まとめている(発生源は違うが、利用者からは同じ「エリアに入った」という
// 状態として扱えるようにするため)。
export const GROUPS = [
  { key: 'fall', label: '転倒・うつ伏せ寝', categories: ['fall', 'prone'] },
  { key: 'ingestion', label: '誤飲', categories: ['ingestion'] },
  { key: 'zone', label: '危険エリアへの接近', categories: ['zone_stairs', 'zone_kitchen', 'zone_genkan', 'intrusion'] },
  { key: 'door_open', label: 'ドアの開閉', categories: ['door_open'] },
  { key: 'night_wandering', label: '夜間徘徊', categories: ['night_wandering'] },
  { key: 'risk_suggestion', label: 'AIリスクサジェスト', categories: ['risk_suggestion'] },
];

// 【重要】ここから下は「初期値・リセット用の既定サンプルデータ」であり、
// 実際に画面に表示される「今の」データは、この配列そのものではなく、下の
// loadIncidents()がlocalStorageから読み込む値(未編集ならこの既定値と同じ)。
// デモ用データモードで自由に追加・編集・削除できるようにするための変更
// (「デモ環境ではすべてのデータの入力や変更ができるようにしてほしい」という
// ご要望への対応。IncidentDataEditorPage.jsx参照)。
export const DEFAULT_INCIDENT_HISTORY = [
  // 階段(UP)付近 — もっとも件数が多い、優先度の高いエリア
  { id: 'inc001', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.55, z: -1.35, time: '2026-08-07T17:42:00+09:00' },
  { id: 'inc002', type: 'fall', category: 'fall', severity: 'danger', label: '階段下収納の前で転倒を検知', x: -1.30, z: -1.10, time: '2026-08-06T08:15:00+09:00' },
  { id: 'inc003', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.65, z: -1.05, time: '2026-08-05T18:03:00+09:00' },
  { id: 'inc004', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.35, z: -1.50, time: '2026-08-04T07:51:00+09:00' },
  { id: 'inc005', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.75, z: -1.20, time: '2026-08-02T19:20:00+09:00' },
  { id: 'inc006', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.20, z: -0.95, time: '2026-07-30T17:10:00+09:00' },

  // キッチン(火気・刃物)付近
  { id: 'inc007', type: 'zone', category: 'zone_kitchen', severity: 'warning', label: 'キッチンエリアに接近', x: 1.65, z: -3.05, time: '2026-08-07T12:22:00+09:00' },
  { id: 'inc008', type: 'zone', category: 'zone_kitchen', severity: 'warning', label: 'キッチンエリアに接近', x: 2.30, z: -3.40, time: '2026-08-03T18:45:00+09:00' },
  { id: 'inc009', type: 'zone', category: 'zone_kitchen', severity: 'warning', label: 'キッチンエリアに接近', x: 2.05, z: -2.90, time: '2026-07-29T12:05:00+09:00' },
  { id: 'inc010', type: 'fall', category: 'fall', severity: 'danger', label: 'キッチンカウンター付近で転倒を検知', x: 2.50, z: -3.10, time: '2026-07-27T13:30:00+09:00' },

  // 玄関の段差付近
  { id: 'inc011', type: 'zone', category: 'zone_genkan', severity: 'warning', label: '玄関の段差エリアに接近', x: -3.20, z: 0.80, time: '2026-08-06T16:05:00+09:00' },
  { id: 'inc012', type: 'zone', category: 'zone_genkan', severity: 'warning', label: '玄関の段差エリアに接近', x: -3.60, z: 1.20, time: '2026-08-01T09:40:00+09:00' },
  { id: 'inc013', type: 'fall', category: 'fall', severity: 'danger', label: '玄関の上がり框で転倒を検知', x: -3.35, z: 1.05, time: '2026-07-25T09:12:00+09:00' },

  // リビング・ダイニング中央付近(ローテーブル・ソファまわりでのつまずき)
  { id: 'inc014', type: 'fall', category: 'fall', severity: 'danger', label: 'ローテーブル付近で転倒を検知', x: 2.80, z: 1.35, time: '2026-08-07T19:58:00+09:00' },
  { id: 'inc015', type: 'fall', category: 'fall', severity: 'danger', label: 'ソファ前で転倒を検知', x: 3.30, z: 0.70, time: '2026-08-04T20:14:00+09:00' },
  { id: 'inc016', type: 'fall', category: 'fall', severity: 'danger', label: 'ローテーブル付近で転倒を検知', x: 2.40, z: 1.90, time: '2026-07-31T19:33:00+09:00' },

  // 和室(座卓まわり)
  { id: 'inc017', type: 'fall', category: 'fall', severity: 'danger', label: '座卓付近で転倒を検知', x: -0.70, z: 2.30, time: '2026-08-05T11:20:00+09:00' },
  { id: 'inc018', type: 'fall', category: 'fall', severity: 'danger', label: '座卓付近で転倒を検知', x: -1.10, z: 1.70, time: '2026-07-28T11:02:00+09:00' },

  // 長期の推移がわかるよう、少し古いデータも数件
  { id: 'inc019', type: 'zone', category: 'zone_stairs', severity: 'danger', label: '階段(UP)付近に接近', x: -1.50, z: -1.15, time: '2026-07-20T18:30:00+09:00' },
  { id: 'inc020', type: 'zone', category: 'zone_kitchen', severity: 'warning', label: 'キッチンエリアに接近', x: 1.80, z: -3.15, time: '2026-07-18T12:40:00+09:00' },
  { id: 'inc021', type: 'fall', category: 'fall', severity: 'danger', label: 'ダイニングテーブル付近で転倒を検知', x: 1.50, z: -0.80, time: '2026-07-15T18:02:00+09:00' },

  // 誤飲の恐れ(小さな部品・おもちゃなどを口に運ぶ動作の検知)
  { id: 'inc022', type: 'ingestion', category: 'ingestion', severity: 'warning', label: 'ローテーブル付近で小物を口に運ぶ動作を検知', x: 2.50, z: 1.55, time: '2026-08-07T09:24:00+09:00' },
  { id: 'inc023', type: 'ingestion', category: 'ingestion', severity: 'warning', label: '座卓まわりのおもちゃで誤飲の恐れのある動作を検知', x: -0.80, z: 1.90, time: '2026-08-04T16:48:00+09:00' },
  { id: 'inc024', type: 'ingestion', category: 'ingestion', severity: 'warning', label: 'ソファ周辺の小物を口に運ぶ動作を検知', x: 3.40, z: 0.90, time: '2026-07-30T10:12:00+09:00' },
  { id: 'inc025', type: 'ingestion', category: 'ingestion', severity: 'warning', label: 'キッチンカウンター付近で小物を口に運ぶ動作を検知', x: 1.70, z: -3.15, time: '2026-07-22T17:36:00+09:00' },

  // うつ伏せ寝(仕様書hazard_type: "prone")。和室の座布団・布団まわりで多い想定。
  { id: 'inc026', type: 'prone', category: 'prone', severity: 'danger', label: '座卓横でうつ伏せ寝を検知', x: -1.20, z: 2.10, time: '2026-08-06T13:40:00+09:00' },
  { id: 'inc027', type: 'prone', category: 'prone', severity: 'danger', label: 'リビングでうつ伏せ寝を検知', x: 2.90, z: 1.75, time: '2026-07-29T14:55:00+09:00' },

  // エリアへの接近(仕様書hazard_type: "intrusion"。AIによる汎用のエリアへの接近検知。
  // zone_stairs等(このアプリ独自のクライアント側判定)とは別データソースの想定)
  { id: 'inc028', type: 'intrusion', category: 'intrusion', severity: 'danger', label: '階段付近への接近をAIが検知', x: -1.60, z: -1.30, time: '2026-08-07T07:55:00+09:00' },
  { id: 'inc029', type: 'intrusion', category: 'intrusion', severity: 'danger', label: 'キッチンへの接近をAIが検知', x: 2.10, z: -3.25, time: '2026-08-02T17:48:00+09:00' },

  // ドアの開閉(仕様書sensor_type: "door"、status: "open"のときのみ履歴化)
  { id: 'inc030', type: 'door_open', category: 'door_open', severity: 'warning', label: '玄関のドアが開いたことを検知', x: -4.20, z: 1.60, time: '2026-08-07T20:10:00+09:00' },
  { id: 'inc031', type: 'door_open', category: 'door_open', severity: 'warning', label: '玄関のドアが開いたことを検知', x: -4.20, z: 1.60, time: '2026-08-03T06:35:00+09:00' },

  // 夜間徘徊(仕様書alert_type: "night_wandering"。ドア開閉+照度の複合アラート)
  { id: 'inc032', type: 'night_wandering', category: 'night_wandering', severity: 'danger', label: '夜間徘徊の疑いを検知(玄関ドアの開閉+低照度)', x: -2.00, z: 0.30, time: '2026-08-06T02:14:00+09:00' },

  // AIリスクサジェスト(仕様書event_type: "risk_suggestion"、details.reason:
  // "unusual_access_time" = 「普段行かない場所へのアクセス」)。実データでは
  // historyApi.jsがAPIレスポンスから生成するが、デモ用データでもこの画面から
  // 追加・編集・削除できることを示すため、既定サンプルとして数件入れている。
  { id: 'inc033', type: 'risk_suggestion', category: 'risk_suggestion', severity: 'danger', label: '潜在的リスク: 普段行かない場所へのアクセス(2階物置)', x: -3.40, z: -2.10, time: '2026-08-07T22:40:00+09:00' },
  { id: 'inc034', type: 'risk_suggestion', category: 'risk_suggestion', severity: 'warning', label: '潜在的リスク: 普段行かない場所へのアクセス(ベランダ側窓)', x: 3.60, z: -1.30, time: '2026-08-05T05:12:00+09:00' },
];

// ===================================================================
// デモ用データの編集(追加・編集・削除)。
//
// 「デモ環境ではすべてのデータの入力や変更ができるようにしてほしい」という
// ご要望を受け、このサンプルデータをlocalStorageに保存し、自由に追加・編集・
// 削除できるようにした(roomConfigContext.jsxの家具・エリア編集と同じ考え方)。
// 未編集の場合はDEFAULT_INCIDENT_HISTORY(上記)がそのまま使われる。
//
// 【重要】このファイルはReactコンポーネントではない(historyApi.js・
// MonitoringDashboard.jsx・HistoryPage.jsxいずれからも呼ばれる共通モジュール)
// ため、roomConfigContext.jsxのようなReact Contextではなく、単純な
// localStorage直読み書きの関数として実装している。呼び出し側(各ページ)は
// 自分がマウントされたとき・データを編集したときに読み直すことで最新の内容を
// 反映する(ページ間のリアルタイム同期までは行わない。ページを開き直せば
// 最新の内容になる)。
const STORAGE_KEY = 'system1.incidentEdits.v1';

let localIdSeq = 0;
function nextIncidentId() {
  localIdSeq += 1;
  return `user_${Date.now()}_${localIdSeq}`;
}

function loadIncidents() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INCIDENT_HISTORY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_INCIDENT_HISTORY;
    return parsed;
  } catch {
    return DEFAULT_INCIDENT_HISTORY;
  }
}

function saveIncidents(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 保存できなくても致命的ではないため無視(プライベートブラウズ等で容量制限にかかる場合がある)
  }
}

// 編集画面(IncidentDataEditorPage.jsx)が一覧表示に使う、現在の全件(未ソート)。
export function getEditableIncidents() {
  return loadIncidents();
}

// 新しい危険行為履歴(risk_suggestionを含む)を1件追加する。
// item: { category, severity, label, x, z, time } (idは自動採番)
export function addIncident(item) {
  const list = loadIncidents();
  const withId = {
    id: nextIncidentId(),
    type: item.category,
    category: item.category,
    severity: item.severity || 'warning',
    label: item.label || '',
    x: Number.isFinite(item.x) ? item.x : 0,
    z: Number.isFinite(item.z) ? item.z : 0,
    time: item.time || new Date().toISOString(),
  };
  saveIncidents([...list, withId]);
  return withId;
}

// 既存の1件を部分的に更新する。
export function updateIncident(id, patch) {
  const list = loadIncidents();
  const next = list.map((inc) => {
    if (inc.id !== id) return inc;
    const merged = { ...inc, ...patch };
    // categoryを変更した場合、type(仕様書のhazard_type相当)もcategoryに揃える
    // (このサンプルデータではtype/categoryは常に同じ値を持つ設計のため)。
    if (patch.category) merged.type = patch.category;
    return merged;
  });
  saveIncidents(next);
}

// 1件削除する。
export function removeIncident(id) {
  const list = loadIncidents();
  saveIncidents(list.filter((inc) => inc.id !== id));
}

// 編集内容をすべて破棄し、既定のサンプルデータに戻す。
export function resetIncidents() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

// 直近が先頭に来るよう時刻降順でソートしたもの(一覧表示用)。
// 編集済みのデータがあればそれを、無ければDEFAULT_INCIDENT_HISTORYを返す。
export function getIncidentsSortedDesc() {
  return [...loadIncidents()].sort((a, b) => new Date(b.time) - new Date(a.time));
}
