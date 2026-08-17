import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { signOut } from 'aws-amplify/auth';
import AppHeader, { HEADER_HEIGHT } from './components/layout/AppHeader';
import MonitoringDashboard from './components/dashboard/MonitoringDashboard';
import YoloCheckPage from './components/diagnostics/YoloCheckPage';
import PolycamCheckPage from './components/diagnostics/PolycamCheckPage';
import RoomSetupPage from './components/room-setup/RoomSetupPage';
import CameraSetupPage from './components/camera-setup/CameraSetupPage';
import FurnitureSetupPage from './components/furniture-zone-setup/FurnitureSetupPage';
import ZoneSetupPage from './components/furniture-zone-setup/ZoneSetupPage';
import DoorSensorSetupPage from './components/door-sensor-setup/DoorSensorSetupPage';
import HistoryPage from './components/history/HistoryPage';
import ConnectionStatusPage from './components/connection-status/ConnectionStatusPage';
import LoginPage from './components/auth/LoginPage';
import VersionBadge from './components/layout/VersionBadge';
import PageErrorBoundary from './components/layout/PageErrorBoundary';
import { useDetectionPipeline } from './hooks/useDetectionPipeline';
import { useMonitoringAlerts } from './hooks/useMonitoringAlerts';
import { RoomConfigProvider } from './roomConfigContext';
import { ThemeProvider, useTheme } from './themeContext';

// 【重要】以前はここでログイン状態をlocalStorageに保存し、ブラウザを閉じても
// ログインしたままになる「ログイン状態を保持する」機能があったが、「サイトを
// 開いたら必ずログイン画面から始まるようにしてほしい」との要望を受けて廃止した。
// 家族共有のタブレットなどで、誰が開いてもダッシュボードがそのまま見えてしまう
// のを避けたい、という利用シーンを想定している。そのため、このファイルでは
// 認証状態をReactのstateのみで保持し(ページを再読み込みすれば消える)、
// localStorageへは一切書き込まない。旧バージョンで保存された古いキーが
// 残っている場合に備えて、起動時に一度だけ掃除しておく(下のuseEffect参照)。
const LEGACY_AUTH_KEYS = ['system1.auth.v1', 'system1.auth.email.v1', 'system1.auth.mode.v1'];

// ===================================================================
// アプリ全体のシェル。
// 【Role C: フロントエンド＆3Dモジュール 仕様書との対応】
// 用語・構成の対応はROLE_C_SPEC_ALIGNMENT.md(リポジトリ直下)を参照。
// このコンポーネント(Root)が仕様書 Step 1「Cognito認証(ログインUI)」の
// 「ルーティングを保護し、未ログイン時はダッシュボードへのアクセスを弾き
// ログイン画面へリダイレクトさせる」に対応する認証ゲートを担う。
// 【重要】「サイトを開いたら必ずログイン画面から始まるようにしてほしい」との
// 要望を受け、以前あった自動ログイン(Cognitoの既存セッションを起動時に
// 確認して自動的にログイン状態にする挙動、およびlocalStorageに保存した
// モック認証フラグによる自動ログイン)は廃止した。client/.env にCognitoの
// 環境変数が設定されている場合でも、ページを開いた直後は必ずログイン画面を
// 表示し、フォーム送信(または「ゲストとして続ける」)を経て初めてログイン
// 状態になる(詳細はROLE_C_SPEC_ALIGNMENT.md参照)。
//
// ・検出パイプライン(Webカメラ/動画 → YOLO → pose-data)はここで一元管理し、
//   どのページを表示していても止まらないようにする。
//   (仕様書 Step 3「MQTT over WebSocketの受信」に相当する通知受信は、
//   現状useDetectionPipeline.js内でSocket.IOによりモックしている。
//   本番はRole AからのMQTTトピック・Role Bからのクレデンシャルを用いて
//   IoT CoreへのWebSocket接続に置き換える)
// ・部屋の形/カメラ設置位置(RoomConfigProvider)もアプリ全体で共有し、
//   「部屋の設定」「カメラ位置の設定」タブでの変更が見守りダッシュボードに
//   即座に反映されるようにする。
// ・ダーク/ホワイトモード(ThemeProvider)もアプリ全体で共有する。
// ・左上のハンバーガーメニューで各ページを切り替える:
//     1. 見守りダッシュボード  … 3Dルーム + 危険通知(本命の画面。仕様書Step 3/4)
//     2. 部屋の設定            … 部屋の形(長方形/L字/自由多角形)入力 or GLTF/GLBの読み込み(仕様書Step 2)
//     3. カメラ位置の設定      … 間取り図でカメラの設置位置・向き・視野角を決める(仕様書Step 4の仮想カメラ配置)
//     4. 家具の設定            … 家具(箱)を間取り図上で自由に配置(以前は「家具・エリアの設定」として1画面だったが分割)
//     5. エリアの設定          … 危険/注意エリアを間取り図上で自由に配置(同上)
//     6. 開閉センサーの設定    … 玄関・勝手口などの開閉センサー(仕様書のsensor_type:"door")を間取り図上に配置
//     7. 危険行為の履歴        … 転倒・危険エリアへの接近の履歴一覧とヒートマップ(仕様書Step 5)
//     8. YOLOの起動・動作確認  … Webカメラ/動画・2Dオーバーレイ・生データ確認
//     9. Polycamの動作確認     … スキャンしたGLTF/GLBの読み込み確認、間取り図画像の確認
//
// 【重要】ログイン画面(LoginPage)は家庭内利用向けのプロトタイプのため、実際の
// 認証は行っていない(Cognito未接続時)。メールアドレス・パスワードを入力する
// UIはあるが、「ログイン」ボタンを押すと入力内容に関わらず常にログインが
// 成功する。ログイン状態はReactのstateのみで保持し、ページの再読み込みや
// ブラウザを閉じて開き直すと必ずログイン画面からやり直しになる(上記参照)。
//
// 【画面切り替え時のパフォーマンス】以前は全ページを常時マウントしたまま
// CSSのdisplay:none/blockで切り替えていたが、部屋の3Dプレビュー(RoomScene)を
// 持つページ(見守りダッシュボード・部屋の設定・カメラ位置の設定・家具の設定・
// エリアの設定)やPolycam確認ページのように、1ページに複数のThree.js
// キャンバス(WebGLコンテキスト)を持つ画面が多く、これらが「非表示のまま」
// 裏側で永久に描画ループを回し続けてしまい、ページを切り替えるたびに
// 動作が固まって見える原因になっていた。そのため現在は「今表示している
// ページだけをマウントする」方式に変更している(下記AppShell参照)。
// ただし、Webカメラ映像(<video>要素)だけはどのページを見ていても検出処理を
// 止めないために例外的に常時マウントしたままにする必要があるため、
// createPortalで表示位置だけをページに応じて動かす形にしている
// (詳細はAppShell内のコメント参照)。
// ===================================================================
export default function App() {
  return (
    <ThemeProvider>
      <RoomConfigProvider>
        <Root />
        {/* ログイン画面・見守り画面のどちらでも常に右下にバージョンを表示する */}
        <VersionBadge />
      </RoomConfigProvider>
    </ThemeProvider>
  );
}

function Root() {
  // 認証状態はReactのstateのみで管理する(localStorageには保存しない)。
  // そのため、ページの再読み込みや新しいタブでの起動では必ずfalseから始まり、
  // ログイン画面が表示される。
  const [authed, setAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  // ログイン方式('cognito'=実際のAmazon Cognito / 'mock'=Cognito未接続時 or
  // 「ゲストとして続ける」でのデモ用ログイン)。ログアウト時にAmplifyの`signOut()`を
  // 呼ぶべきかどうかの判定に使う。
  const [authMode, setAuthMode] = useState('mock');

  // 起動時に一度だけ、旧バージョンがlocalStorageへ保存していた認証フラグが
  // 残っていれば削除しておく(自動ログインが復活してしまわないようにするため)。
  useEffect(() => {
    try {
      LEGACY_AUTH_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch { /* noop */ }
  }, []);

  // 【重要・バグ修正】「サイトを開いたら必ずログイン画面から始まる」ようにするため、
  // このアプリ側の認証状態(authed)はReactのstateのみで管理し、ページ再読み込みの
  // たびに必ずfalseから始まる。しかし、Amplify(aws-amplify/auth)自体は既定で
  // ログイン済みセッションをブラウザのlocalStorageに保持し続けるため、以前
  // ログインしたことがある端末では「アプリ側は未ログイン扱いなのに、Amplify内部は
  // まだログイン済みだと思っている」という状態がずれたまま残ってしまっていた。
  // この状態でログインフォームからCognitoに再度signIn()しようとすると、
  // Amplifyが `UserAlreadyAuthenticatedException`(「既にログイン済みのセッションが
  // 残っています。一度ページを再読み込みしてからお試しください」)を投げてログインが
  // 失敗する不具合があった(再読み込みしても、Amplify側のセッションはlocalStorageに
  // 残ったままのため、実際には解決しないケースがあった)。
  // 対策として、ログイン画面に到達した(=起動直後、まだ未ログイン)タイミングで
  // Amplify側の古いセッションも明示的に破棄しておく。これにより、アプリ側の
  // 「毎回ログイン画面から始まる」という仕様と、Amplify側のセッション状態を
  // 常に一致させ、上記の衝突エラーが起きないようにする(失敗しても画面には
  // 影響しないよう握りつぶす。Cognito未設定環境では何も起きない)。
  useEffect(() => {
    signOut().catch(() => { /* noop */ });
  }, []);

  const handleLogin = (payload) => {
    const email = payload?.email || '';
    const mode = payload?.mode || 'mock';
    setUserEmail(email);
    setAuthMode(mode);
    setAuthed(true);
  };

  const handleLogout = () => {
    if (authMode === 'cognito') {
      // Amplifyが保持しているCognitoトークンも破棄する(失敗しても画面上は
      // ログアウト扱いにする)。
      signOut().catch(() => { /* noop */ });
    }
    setAuthed(false);
  };

  if (!authed) {
    return <LoginPage onLogin={handleLogin} />;
  }
  return <AppShell userEmail={userEmail} authMode={authMode} onLogout={handleLogout} />;
}

function AppShell({ userEmail, authMode, onLogout }) {
  const [page, setPage] = useState('dashboard');
  const { theme } = useTheme();

  // Webカメラ/動画の実体である<video>要素を、今どのDOM要素の中に表示するか。
  // 「YOLOの起動・動作確認」ページが表示されている間はそのページ内のプレースホルダー
  // (下のcreatePortal呼び出し参照)、それ以外のページでは誰も指定しないためnullのまま
  // となり、画面外に飛ばして非表示にする(下記video要素のstyle参照)。
  // こうすることで、videoRefの指す実際の<video>要素は常に同じ1つのDOMノードを
  // 使い続けたまま(=Webカメラ映像の取得・フレーム送信が途切れない)、見た目の
  // 表示位置だけをページに応じて切り替えられる。
  const [videoSlot, setVideoSlot] = useState(null);

  const {
    videoRef,
    fileInputRef,
    inputMode,
    setInputMode,
    handleFileChange,
    connected,
    poseData,
    lastPoseAt,
    shouldCapture,
    cameraError,
    requestWebcam,
  } = useDetectionPipeline();

  // 転倒検知・危険エリアへの接近・開閉センサーの通知などの評価は、ここ(常時マウントの
  // AppShell)で行う。以前は見守りダッシュボード側で呼び出していたため、他の設定
  // タブを見ている間は評価そのものが止まってしまっていた(「今表示しているページ
  // だけをマウントする」というパフォーマンス対策の副作用。詳細はMonitoringDashboard.jsx
  // 冒頭のコメント参照)。ここで呼び出すことで、どのページを見ていても危険通知が
  // 途切れなくなる。
  const monitoringAlerts = useMonitoringAlerts(pipeline.poseData, pipeline.lastPoseAt, pipeline.connected, pipeline.iotMessage);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: theme.appBg }}>
      {/* 共通ヘッダー。メニュー開閉・アプリ名・接続状況・アカウント(ログアウト)を
          1本のバーにまとめ、どのページを表示していても画面上部に固定表示する。 */}
      <AppHeader
        currentPage={page}
        onNavigate={setPage}
        connected={connected}
        userEmail={userEmail}
        authMode={authMode}
        onLogout={onLogout}
      />

      {/* Webカメラ/動画の<video>要素は、どのページを表示していても検出処理
          (フレームキャプチャ→サーバー送信)を止めないよう、ページの
          マウント状態に関係なく常にDOM上に存在させ続ける必要がある。
          videoSlot(YoloCheckPageが登録するプレースホルダー)が無いときは
          画面外に追いやって見えないようにしておく。 */}
      {createPortal(
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={videoSlot
            ? { width: '480px', height: '360px', background: '#000', borderRadius: '8px', objectFit: 'cover' }
            : { position: 'fixed', top: -9999, left: -9999, width: 2, height: 2, opacity: 0, pointerEvents: 'none' }}
        />,
        videoSlot || document.body,
      )}

      {/* ヘッダーの高さぶん(HEADER_HEIGHT)だけ本文を下にずらし、かつこの領域内だけで
          スクロールさせることで、ヘッダーを常に画面上部に固定表示したままにする。
          【重要】各ページは「今表示しているページだけをマウントする」ようにしている
          (以前はCSSのdisplay:none/blockで全ページ常時マウントしていたため、
          Three.jsの3Dプレビューを持つページが同時にいくつも裏側で描画ループを
          回し続け、画面切り替え時に固まって見える原因になっていた)。 */}
      <div style={{ position: 'fixed', top: HEADER_HEIGHT, left: 0, right: 0, bottom: 0, overflow: 'auto' }}>
        {/* ページ単位のエラー境界。resetKeyにpage(表示中のページ名)を渡すことで、
            あるページの表示中に何らかの例外が起きても、メニューから別のページへ
            移動→戻ってくれば自動的に再挑戦できるようにしている。 */}
        <PageErrorBoundary resetKey={page}>
          {page === 'dashboard' && (
            <div style={{ height: '100%' }}>
              <MonitoringDashboard
                connected={connected}
                poseData={poseData}
                lastPoseAt={lastPoseAt}
                inputMode={inputMode}
                shouldCapture={shouldCapture}
                cameraError={cameraError}
                requestWebcam={requestWebcam}
                {...monitoringAlerts}
              />
            </div>
          )}

          {page === 'roomSetup' && <RoomSetupPage />}

          {page === 'cameraSetup' && <CameraSetupPage />}

          {page === 'furnitureSetup' && <FurnitureSetupPage />}

          {page === 'zoneSetup' && <ZoneSetupPage />}

          {page === 'doorSensorSetup' && <DoorSensorSetupPage />}

          {page === 'history' && <HistoryPage />}

          {page === 'connectionStatus' && (
            <ConnectionStatusPage
              authMode={authMode}
              userEmail={userEmail}
              connected={connected}
              cameraError={cameraError}
              shouldCapture={shouldCapture}
              requestWebcam={requestWebcam}
              lastPoseAt={lastPoseAt}
            />
          )}

          {page === 'yolo' && (
            <YoloCheckPage
              registerVideoSlot={setVideoSlot}
              fileInputRef={fileInputRef}
              inputMode={inputMode}
              handleFileChange={handleFileChange}
              connected={connected}
              poseData={poseData}
              lastPoseAt={lastPoseAt}
              shouldCapture={shouldCapture}
              cameraError={cameraError}
              requestWebcam={requestWebcam}
            />
          )}

          {page === 'polycam' && <PolycamCheckPage />}
        </PageErrorBoundary>
      </div>
    </div>
  );
}
