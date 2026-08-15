// ===================================================================
// AWS IoT Core への MQTT over WebSocket 接続の準備コード。
//
// 【Role C仕様書 Step 3「MQTT over WebSocketの受信」との対応】
// ROLE_C_SPEC_ALIGNMENT.md にある「SigV4署名付きURL生成・IoT Core接続」の
// 実体。ただし【重要】このファイルの関数は、現時点ではアプリのどこからも
// 呼び出されていない(=UIには配線されていない、準備・下ごしらえのみ)。
// 理由: 実際にsubscribeすべきMQTTトピック名(Role Aの検出結果がどのトピックに
// publishされるか)がまだ共有されていないため。実際に接続するには
// 最低限そのトピック名が必要。
//
// 本番化する際の想定手順:
//   1. Role Aから実際のMQTTトピック名(例: `iot/{deviceId}/pose` 等、仮)を受領する
//   2. hooks/useDetectionPipeline.js 内の `socket.on('pose-data', ...)` (Socket.IO)を
//      このファイルの `connectIotCore(topic, onMessage)` に置き換える
//   3. StatusBar.jsxの接続状態表示の文言も「サーバー接続中」から
//      「IoT Core接続中」のような表現に更新する
//
// 仕組み(このファイルがやっていること):
//   1. ログイン中ユーザーのCognito Identity Poolから一時AWSクレデンシャルを取得する
//      (`aws-amplify/auth`の`fetchAuthSession()`。amplifyConfig.jsで
//      Identity Poolを設定していることが前提。User Poolでログイン済みの
//      ユーザーに対して、Identity Poolがそのユーザー用の一時クレデンシャルを
//      発行する、Cognitoの標準的な「認証済みID連携」の仕組みを利用している)。
//   2. そのクレデンシャルでAWS Signature Version 4 (SigV4) により、
//      IoT CoreのMQTT over WebSocketエンドポイントへの接続URLに署名する
//      (IoT CoreのWebSocketエンドポイントは、クエリパラメータへのSigV4署名
//      でのみ認証できる仕様のため)。署名処理はブラウザ標準のWeb Crypto API
//      (`crypto.subtle`)だけで実装しており、追加のAWS SDKには依存していない。
//   3. 署名済みURLに対して `mqtt` (npm: mqtt.js) でWebSocket接続し、
//      指定したトピックをsubscribeする。
// ===================================================================

import { fetchAuthSession } from 'aws-amplify/auth';

const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT || '';
const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'ap-southeast-1';

function textToBytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, msg) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? textToBytes(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, textToBytes(msg));
  return new Uint8Array(sig);
}

async function sha256Hex(msg) {
  const digest = await crypto.subtle.digest('SHA-256', textToBytes(msg));
  return bytesToHex(new Uint8Array(digest));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// SigV4で使う "YYYYMMDDTHHMMSSZ" (UTC)形式の日時文字列と "YYYYMMDD" の日付文字列を作る。
function amzDateParts(date) {
  const amzDate =
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  const dateStamp = amzDate.slice(0, 8);
  return { amzDate, dateStamp };
}

// IoT CoreのMQTT over WebSocketエンドポイント(GET /mqtt)向けに、
// AWS Signature Version 4のプレサインドURLを組み立てる。
async function buildSignedWebSocketUrl({ endpoint, region, accessKeyId, secretAccessKey, sessionToken }) {
  const service = 'iotdevicegateway';
  const method = 'GET';
  const canonicalUri = '/mqtt';
  const host = endpoint;
  const { amzDate, dateStamp } = amzDateParts(new Date());
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const algorithm = 'AWS4-HMAC-SHA256';

  const queryParams = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuerystring = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = await sha256Hex(''); // GETリクエストのためボディは空

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

  let url = `wss://${host}${canonicalUri}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
  if (sessionToken) {
    // セッショントークン自体は署名対象(SignedHeaders)には含めないが、
    // Cognito Identity Poolの一時クレデンシャルには必須のためクエリに付与する。
    url += `&X-Amz-Security-Token=${encodeURIComponent(sessionToken)}`;
  }
  return url;
}

// ログイン中ユーザーのCognito Identity Poolクレデンシャルを使って、
// IoT Core接続用の署名済みWebSocket URLを取得する。
export async function getSignedIotWebSocketUrl() {
  if (!IOT_ENDPOINT) {
    throw new Error('VITE_IOT_ENDPOINT が設定されていません(client/.env を確認してください)');
  }
  const session = await fetchAuthSession();
  const creds = session?.credentials;
  if (!creds?.accessKeyId || !creds?.secretAccessKey) {
    throw new Error(
      'AWSの一時クレデンシャルを取得できませんでした' +
      '(Cognitoにログイン済みか、Identity Poolが設定されているかご確認ください)',
    );
  }
  return buildSignedWebSocketUrl({
    endpoint: IOT_ENDPOINT,
    region: AWS_REGION,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  });
}

// 実際にAWS IoT CoreへMQTT接続し、指定トピックをsubscribeする。
// 【現状どこからも呼ばれていない】Role AのMQTTトピック名が判明し、
// useDetectionPipeline.js等から実際に呼び出す準備ができてから使用する。
//
// 使い方(将来の想定。useMonitoringAlerts()が返すpushNotificationと組み合わせる例):
//   const client = await connectIotCore('iot/device1/alerts', (topic, payload) => {
//     const notif = describeIotEvent(payload); // 仕様書のJSONを通知の形に変換(下記関数)
//     if (notif) pushNotification(notif.key, notif);
//   });
//   ...
//   client.end(); // クリーンアップ時
export async function connectIotCore(topic, onMessage) {
  const mqtt = await import('mqtt');
  const url = await getSignedIotWebSocketUrl();
  const client = mqtt.connect(url, {
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 4000,
    // IoT CoreのMQTT over WebSocketは接続ごとに一意なクライアントIDが必要。
    clientId: `system1-web-${Math.random().toString(16).slice(2)}`,
  });

  client.on('connect', () => {
    if (topic) client.subscribe(topic);
  });

  client.on('message', (receivedTopic, payloadBuffer) => {
    const text = payloadBuffer.toString();
    try {
      onMessage?.(receivedTopic, JSON.parse(text));
    } catch {
      onMessage?.(receivedTopic, text);
    }
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[iotClient] MQTT接続エラー:', err);
  });

  return client;
}

// ===================================================================
// AWS IoT Coreから受信するJSON(https://d1-docs.pages.dev/ で確認した
// 「システム共通JSONスキーマ」。historyApi.js が履歴APIの解釈に使っている
// ものと同じ3パターン)を、見守りモニターの危険通知(useMonitoringAlerts.js
// が返す pushNotification(key, {title, message, level}) にそのまま渡せる形)
// に変換するヘルパー。
//
// 【まだどこからも呼ばれていない】connectIotCore()と同様、実際にRole Aから
// MQTTトピック名を受領してonMessageコールバックを配線する段階になったら、
// その中でこの関数を呼び出す想定(上のconnectIotCoreの使い方コメント参照)。
//
// 仕様書に定義の無い hazard_type / sensor_type / alert_type、または
// 「危険行為」として通知する意味の薄いイベント(温度センサーの値など)は
// nullを返し、その通知は無視する(historyApi.jsのnormalizeIncident()と
// 判定基準を揃えている)。
export function describeIotEvent(raw) {
  if (!raw || typeof raw !== 'object' || !raw.event_type) return null;
  const details = raw.details || {};

  if (raw.event_type === 'ai_hazard') {
    const confPct = typeof details.confidence === 'number' ? Math.round(details.confidence * 100) : null;
    const confSuffix = confPct !== null ? `(確信度${confPct}%)` : '';
    switch (details.hazard_type) {
      case 'fall':
        return { key: 'iot_fall', title: '転倒検知', message: `転倒を検知しました${confSuffix}。至急ご確認ください。`, level: 'danger' };
      case 'prone':
        return { key: 'iot_prone', title: 'うつ伏せ寝', message: `うつ伏せ寝を検知しました${confSuffix}。`, level: 'danger' };
      case 'intrusion':
        return { key: 'iot_intrusion', title: '危険エリアへの侵入', message: `AIがエリアへの侵入を検知しました${confSuffix}。`, level: 'danger' };
      default:
        return null; // 仕様書に無いhazard_type
    }
  }

  if (raw.event_type === 'sensor_alert') {
    // ドアが「開いた」ときだけ通知する(履歴API側のhistoryApi.jsと判定基準を揃えている)。
    // 温度センサーの値は「危険行為」ではないため通知対象外。
    if (details.sensor_type === 'door' && details.status === 'open') {
      return { key: 'iot_door_open', title: 'ドアの開閉', message: 'ドアが開いたことを検知しました。', level: 'warning' };
    }
    return null;
  }

  if (raw.event_type === 'complex_alert' && details.alert_type === 'night_wandering') {
    const luxNote = typeof details.lux === 'number' ? `(照度${details.lux}lux)` : '';
    return {
      key: 'iot_night_wandering',
      title: '夜間徘徊の疑い',
      message: `夜間徘徊の疑いを検知しました${luxNote}。`,
      level: 'danger',
    };
  }

  return null;
}
