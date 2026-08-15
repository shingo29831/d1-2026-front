import io from 'socket.io-client';
import { SOCKET_SERVER_URL } from './config';

// 【Role C仕様書 Step 3「MQTT over WebSocketの受信」との対応】
// 仕様書ではAWS IoT Coreへ`aws-iot-device-sdk-v2`または`mqtt.js`で
// WebSocket接続し、SigV4署名付きURLでMQTTトピックをSubscribeする想定だが、
// このプロトタイプではSocket.IOによるモック実装になっている
// (詳細・移行手順はROLE_C_SPEC_ALIGNMENT.md参照)。
// 本番化する際は、このファイルを iotClient.js (mqtt.jsベースの接続モジュール、
// SigV4署名・IoT Core接続を実装済みだがMQTTトピック名が未確定のため未配線)に
// 置き換え、呼び出し側(useDetectionPipeline.js等)のイベント名もMQTTトピック
// 購読に合わせて変更する想定。
//
// アプリ全体で単一のsocket接続を共有する。
// ページ(ダッシュボード/YOLO確認/Polycam確認)を切り替えても
// 接続が張り直されないようにモジュールスコープで1つだけ生成する。
// SOCKET_SERVER_URLが空文字の場合はundefinedにして、
// socket.ioクライアントに「現在のページと同一オリジンへ接続」させる
// (Docker/Caddy経由でCORSなしに動かすための挙動)
const socket = io(SOCKET_SERVER_URL || undefined, {
  autoConnect: true,
  reconnection: true,
});

export default socket;
