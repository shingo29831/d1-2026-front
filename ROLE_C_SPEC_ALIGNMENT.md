# Role C(フロントエンド＆3Dモジュール)仕様書 用語対応表

このドキュメントは、「Role C フロントエンド＆3Dモジュール」仕様書の用語・構成
(Cognito認証、MQTT over WebSocket、Raycaster投影、InstancedMeshヒートマップ等)と、この
`System_1` リポジトリの実装との対応関係をまとめたものです。

**仕様書の参照元:** [https://d1-docs.pages.dev/](https://d1-docs.pages.dev/)
(トップページ、[role_a.html](https://d1-docs.pages.dev/role_a.html)、
[role_b.html](https://d1-docs.pages.dev/role_b.html)、
[role_c.html](https://d1-docs.pages.dev/role_c.html)、
[app.html](https://d1-docs.pages.dev/app.html)=ダッシュボードUIモック)。
以前チャットで共有いただいたJSONスキーマの抜粋と同一内容です。

**更新(2026-08-14b):** 「接続状況」診断ページ(`client/src/components/ConnectionStatusPage.jsx`)を追加しました。
Cognito・IoT Core・履歴API・S3・検出パイプライン(Webカメラ/見守りサーバー)の接続状況を1画面で
確認できます。ハンバーガーメニューの「接続状況」から開けます。仕様書に明記された機能ではなく、
運用・デバッグ用にこのAIが追加した独自ツールです。詳細は本文末尾の「補足」を参照してください。

**更新(2026-08-14):** 上記サイトで「システム共通JSONスキーマ」(下記参照)が正式に確認できたため、
Step 5(履歴API)・Step 3/4(MQTT/IoT Core受信、まだUI未配線の準備コード側)のデータ解釈を、
それまでの推測ベースの実装から、この確定スキーマに厳密準拠する実装へ置き換えました。

**更新(2026-08-10):** Role Bから実際のCognito User Pool ID・Client ID・Identity Pool ID・
IoT Coreエンドポイント・履歴API(モック)URL・テストユーザーを受領し、Step 1(ログイン)と
Step 5(履歴取得)を実装に反映しました。Step 3(MQTT/IoT Core)はコード自体は準備済みですが、
Role AからのMQTTトピック名が未確定のためUIにはまだ配線していません。Step 6(S3デプロイ)も
スクリプトを用意しましたが、デプロイ実行用の別のAWS IAMクレデンシャルが無いため未実行です。
**なお、開発時のAIのサンドボックス環境からはAWSの各エンドポイントへ外部通信ができないため、
下記の実装はすべて「コードレビュー・ビルド確認」のみで、実際のCognitoログイン・履歴API疎通・
IoT Core接続の動作確認はできていません。** お客様の環境(実際にインターネットに出られる環境)での
最初の動作確認をお願いします。エラーが出た場合はメッセージを教えていただければ修正します。
各行の「状態」列は、現時点でのこのリポジトリの状況を表します。

## システム共通JSONスキーマ(確定版)

Role A(エッジ)→ AWS IoT Core / DynamoDB → Role C(フロントエンド)まで一貫して使われる
JSONの形。`client/src/historyApi.js`(履歴API用)と `client/src/iotClient.js`
(`describeIotEvent()`、MQTT受信用・まだUI未配線)の両方が、この形をそのまま解釈する。

外側の共通形: `{ device_id, room_id, timestamp(エポックミリ秒), event_type, details }`

| event_type | details の内容 | このアプリでの扱い |
|---|---|---|
| `ai_hazard` | `hazard_type`("fall"\|"prone"\|"intrusion")、`x`,`y`(画像上のピクセル座標)、`confidence` | `fall`→転倒検知、`prone`→うつ伏せ寝、`intrusion`→エリア侵入(AI検知)としてそれぞれ履歴/通知化。**x, yは画像上のピクセル座標であり、間取り図の床座標(メートル)への変換にはRole A提供のカメラキャリブレーション行列が必要だが未受領のため、床座標は不明として扱う(下記「座標の扱い」参照)** |
| `sensor_alert` | `sensor_type`("door"\|"temperature")、`status`、`battery_level` | `sensor_type==="door"` かつ `status==="open"` のときだけ「ドアの開閉」として履歴/通知化。`temperature`(気温)は「危険行為」ではないため対象外(意図的に無視) |
| `complex_alert` | `alert_type`("night_wandering")、`trigger_device`、`lux` | 「夜間徘徊の疑い」として履歴/通知化 |

### 設計判断(仕様書に明記が無く、このAIが暫定的に決めた点)

- **「誤飲」カテゴリの扱い:** 仕様書のhazard_type一覧(fall/prone/intrusion)には「誤飲」が
  含まれていない。以前の要望で追加した「誤飲」フィルター・サンプルデータはそのまま
  `incidentHistory.js` に残し画面上でも表示されるが、**実際のAPI/MQTTデータの解釈
  (`historyApi.js`・`iotClient.js`)は仕様書の値だけに厳密に従うため、実データから
  「誤飲」が生成されることはない**(デモ・確認用のモック専用カテゴリという位置付け)。
- **座標の扱い(ai_hazardのx, y):** カメラキャリブレーション行列を受領するまでの暫定対応として、
  床座標が不明な履歴/通知は**部屋の中心に概算配置**し、画面上で「位置は概算」と明記する
  (`HistoryPage.jsx`の`approx`フラグ。点線の輪付きマーカー・バッジで区別し、
  発生密度のヒートマップ計算にも含めない=実際に無い「中心のホットスポット」に見えないようにしている)。
  キャリブレーション行列を受領し次第、`historyApi.js`のコメントを参考に本来の2D→3D変換に置き換える。

## Step 1: Cognito認証(ログインUI)

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| ログイン画面(メール/パスワード) | `client/src/components/LoginPage.jsx` | 実装済み。`client/.env`にCognitoの値が設定されていれば`aws-amplify`の`signIn`で実際のUser Poolに認証する。未設定時は従来通りのモック認証(常に成功)にフォールバック |
| ルーティング保護・未ログイン時のリダイレクト | `client/src/App.jsx` (`Root`コンポーネント) | 実装済み。起動時に`getCurrentUser()`で既存Cognitoセッションの有無を確認し、有効なら自動ログインする |
| セッション維持(トークン保存) | Amplify自体が管理(`aws-amplify`が内部でlocalStorageにトークンを保存)。`client/src/App.jsx`はUI表示用の付随フラグのみ管理 | 実装済み(実際のCognitoログイン時はAmplify標準のトークン管理に委ねる) |
| Amplify Auth / Identity Poolからの一時クレデンシャル取得 | `client/src/amplifyConfig.js`(設定)、`client/src/authToken.js`・`client/src/iotClient.js`(取得・利用) | 実装済み |
| APIへの`Authorization`ヘッダ付与 | `client/src/historyApi.js`(`getIdToken()`でIDトークンを取得し`Authorization: Bearer`を付与) | 実装済み |
| パスワードの取り扱い | (該当ファイル無し・意図的) | ログインフォームで人が都度入力するのみで、`client/.env`・ソースコード・ドキュメントのどこにも保存していない |

## Step 2: React + Three.jsによる3D空間の構築

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| `@react-three/fiber` / `@react-three/drei` セットアップ | `client/src/components/RoomScene.jsx` | 実装済み |
| `useGLTF`によるモデル読み込み・OrbitControls | `client/src/components/GltfRoom.jsx`、`RoomScene.jsx`内`OrbitControls` | 実装済み |
| Polycamスキャンモデルの配置 | `client/src/components/RoomSetupPage.jsx`(GLTF/GLBアップロードUI)、`client/public/models/` | 実装済み(アップロードUIあり) |
| モデル未指定時のプレースホルダー部屋 | `client/src/components/PlaceholderRoom.jsx` | 実装済み(独自機能。仕様書にはない、Polycamモデル未取得時の代替表示) |
| Decimate/Draco圧縮による軽量化 | (未対応、Blender等での事前加工が前提) | ⏳ 実際のPolycamスキャンモデルを使う際に必要 |
| `Suspense`によるローディングUI | `client/src/components/RoomScene.jsx`(`Suspense` + `GltfErrorBoundary`) | 実装済み |

## Step 3: MQTT over WebSocketの受信

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| リアルタイム通知の受信(現在アプリが実際に使っている経路) | `client/src/socket.js`、`client/src/hooks/useDetectionPipeline.js` | モック実装。**Socket.IO** を使用しており、仕様書の **MQTT over WebSocket(IoT Core / `mqtt.js`)** ではない |
| SigV4署名付きURL生成・IoT Core接続(準備コード) | `client/src/iotClient.js` | コード実装済み・**UIには未配線**。Web Crypto APIによるSigV4署名、Cognito Identity Poolからの一時クレデンシャル取得、`mqtt.js`によるWebSocket接続まで実装済みだが、Role AからのMQTTトピック名が未確定のため`useDetectionPipeline.js`からはまだ呼ばれていない |
| 受信JSON(共通スキーマ)→通知への変換 | `client/src/iotClient.js`の`describeIotEvent()` | 実装済み(上記「システム共通JSONスキーマ」に準拠。UI配線後は`onMessage`内でこれを呼び、戻り値をそのまま`useMonitoringAlerts()`の`pushNotification`に渡す想定) |
| 自動再接続(Exponential Backoff) | `socket.io-client`の`reconnection: true`(既定の再接続のみ)。`iotClient.js`は`mqtt.js`標準の`reconnectPeriod`(固定間隔)を設定 | 一部実装(簡易) |
| 接続中/オフラインのステータス表示 | `client/src/components/StatusBar.jsx`(「サーバー接続中/サーバー未接続」表示) | 実装済み(表示名は現状の接続方式=Socket.IOに合わせた文言。`iotClient.js`をUIに配線する際に表示文言も更新予定) |

## Step 4: リアルタイムアラートの3Dマッピング

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| カメラの内部/外部パラメータに基づく仮想カメラ配置 | `client/src/components/CameraMount.jsx`、`client/src/components/CameraSetupPage.jsx` | 実装済み(位置・向き・FOVのみ。歪み係数等の内部パラメータは未対応) |
| 2D→3D逆投影・Raycasterによる床面座標算出 | (未実装) | ⏳ Role Aからのキャリブレーション行列を受領後に対応。現状は検出結果をあらかじめ床座標(x, z)として扱う簡易モデル(`client/src/poseGeometry.js`)。仕様書で確認できた`ai_hazard`のx, yが画像上のピクセル座標であることは確定しているが、行列自体・共有方法はまだ仕様書に明記が無い |
| アラートマーカー描画 | `client/src/components/PersonFigure.jsx`、`client/src/components/DangerZoneMarkers.jsx` | 実装済み(簡易床座標ベース) |

## Step 5: 履歴データの可視化(ヒートマップ)

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| 履歴API(JWTトークン付き)からのデータ取得 | `client/src/historyApi.js`(取得・JWT付与・レスポンス正規化)、`client/src/incidentHistory.js`(フォールバック用サンプルデータ) | 実装済み。`VITE_HISTORY_API_URL`が設定されていれば実APIから取得し、未設定/通信エラー/レスポンス形式不一致の場合は自動的にサンプルデータへフォールバックする(画面上部にどちらを表示中か案内表示あり)。**レスポンスの解釈は上記「システム共通JSONスキーマ」に厳密準拠(device_id/room_id/timestamp/event_type/details)に更新済み**(以前は実際のフィールド名が不明だったため複数候補を試す寛容な実装だったが、仕様書で確定したため正確なパーサーに置き換えた) |
| 危険行為の種類ごとの絞り込み | `client/src/incidentHistory.js`(`CATEGORIES`/`GROUPS`)、`client/src/components/HistoryPage.jsx` | 実装済み。仕様書のhazard_type/sensor_type/alert_type(fall/prone/intrusion/door_open/night_wandering)をカテゴリとして追加。加えて、このアプリ独自のzone_*(エリアごとのクライアント側判定)・ingestion(誤飲、仕様書に無いデモ専用)も引き続き選択可能 |
| 「家具・エリアの設定」タブのエリアごとの絞り込み | `client/src/components/HistoryPage.jsx`(`zoneIdForIncident()`) | 実装済み(独自機能。座標(x, z)がどのエリアの矩形内かで動的に絞り込む。エリアを追加すれば選択肢も自動的に増える) |
| ヒートマップ/パーティクル生成 | `client/src/components/HistoryPage.jsx` | 実装済み(間取り図上のSVGヒートマップ。3D空間内のパーティクルではない)。床座標が不明(概算)な項目は密度計算から除外し、点線の輪付きマーカーとして個別表示のみ行う |
| `InstancedMesh`によるGPU側一括描画 | (未対応) | ⏳ 現状はデータ件数が少ないSVG実装のため未着手。実データ規模が判明し3D空間上に描画する方式に変更する際に対応 |

## Step 6: プロダクションビルドとデプロイ

| 仕様書の用語 | 対応するファイル | 状態 |
|---|---|---|
| `npm run build`によるプロダクションビルド | `client/package.json` | 実装済み |
| S3バケットへのアップロード | `deploy-s3.sh` / `deploy-s3.bat`(リポジトリ直下) | スクリプト準備済み・**未実行**。バケット名(`cisco-sin-frontend-966042698775-ap-southeast-1-an`)は設定済みだが、デプロイ実行用のAWS IAMクレデンシャル(ログイン用のCognito情報とは別物)が無く、かつAI開発環境からAWSへ通信できないため、実際のアップロードはお客様側の環境での実行が必要 |
| CloudFrontの404→`index.html`フォールバック設定 | (未対応、Role B側の設定事項) | ⏳ Role Bへ設定完了の確認を依頼(仕様書「3. 他ロールとの連携ポイント」参照) |
| 環境変数(`.env`)によるエンドポイント分離 | `client/.env`、ルート`.env.example`(Docker/`restart.bat`経由用) | 実装済み。Socket.IOサーバーURLに加え、Cognito User Pool/Client/Identity Pool ID・IoT Coreエンドポイント・履歴API URLも環境変数化済み(テスト用パスワードのみ、意図的にどこにも保存していない) |

## 他ロールとの連携ポイント(現状の窓口ファイル)

- **Role Aへの依頼事項**(カメラ設置位置・角度・FOV・キャリブレーション行列の実際の値/共有形式、MQTTトピック名): `client/src/config.js`(`CAMERA_MOUNT`, `CAMERA_YAW_DEG`, `CAMERA_FOV_DEG`)がキャリブレーション行列の受け皿。**キャリブレーション行列を受領後、`historyApi.js`/`iotClient.js`の「x, zはnull(概算配置)」としている部分を実際の2D→3D変換に置き換えてください**。**MQTTトピック名を受領後は、`client/src/iotClient.js`の`connectIotCore(topic, ...)`+`describeIotEvent()`を`useDetectionPipeline.js`から呼び出す形に配線してください**(コード自体は準備済み)。
- **Role Bへの依頼事項**(デプロイ実行用のS3書き込み権限を持つAWS IAMクレデンシャル): 履歴APIのレスポンス形式は仕様書サイト(d1-docs.pages.dev)で確定・実装済みのため追加確認は不要になった。残る依頼事項は`deploy-s3.sh`/`deploy-s3.bat`実行用の、ログイン用Cognito情報とは別の、S3書き込み権限を持つAWS IAMクレデンシャルのみ。

## まとめ

`System_1` は、Role Cの仕様書が最終的に到達すべき構成(Cognito / MQTT over WebSocket /
IoT Core / S3・CloudFront)のうち、**Cognitoログイン(Step 1)と履歴API連携(Step 5、
仕様書の共通JSONスキーマに厳密準拠)は実際のAWSリソースに接続する実装まで完了**しました
(ただしAI開発環境からAWSへ疎通できないため、実機での動作確認はまだです)。
IoT Core接続(Step 3)はコード・受信JSON解釈(`describeIotEvent()`)ともに準備済みでUI未配線、
Step 4の2D→3D座標変換とStep 6のS3デプロイ実行は、それぞれRole Aのキャリブレーション行列・
Role Bのデプロイ用IAMクレデンシャルの受領待ちです。上記の「⏳」がついた項目が、
Role A・Role Bからの追加情報を受領し次第、本番構成へ置き換えていく残作業です。

## 補足: 接続状況の可視化(診断ページ)

仕様書には無い、運用・デバッグ用にこのAIが追加した独自ページです。ハンバーガーメニューの
「接続状況」から開けます(`client/src/components/ConnectionStatusPage.jsx`)。

| セクション | 確認方法 |
|---|---|
| ① AWS Cognito | ページ表示時に自動で`fetchAuthSession()`を呼び、有効なIDトークンを取得できるか確認 |
| ② AWS IoT Core | 手動の「接続テストを実行」ボタン。実際にMQTT over WebSocketで接続を試みる(最大10秒待機)。自動実行にしていない理由は、一時クレデンシャルの取得や接続確立に時間がかかりうるため |
| ③ 履歴API | ページ表示時に自動で`fetchIncidentsSortedDesc()`を呼び、実データ('api')かサンプルデータへのフォールバック('mock')かを確認 |
| ④ S3 | ブラウザから書き込み状況を直接確認する手段が無いため、設定値(バケット名・リージョン)の表示のみ |
| ⑤ 検出パイプライン | `useDetectionPipeline()`の状態(Webカメラ・見守りサーバーとの接続)をそのまま表示 |

**【重要】** ⑤の「検出パイプライン」欄は、実際のCisco Meraki MVカメラの生死を示すものではありません。
このフロントエンドは実際のMerakiカメラには直接接続しておらず、カメラ映像のAI解析はRole A
(クラウド/AI側)の担当範囲です。IoT Core経由の配線が完了するまでの代替として、このブラウザ自身の
Webカメラを見守りサーバー(Socket.IO)へ送信する動作確認用デモを使っており、その接続状況を表示して
います。誤解を招かないよう、ページ内にもその旨を明記しています。
