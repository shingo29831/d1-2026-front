import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
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
import { useDetectionPipeline } from './hooks/useDetectionPipeline';
import { useMonitoringAlerts } from './hooks/useMonitoringAlerts';
import { RoomConfigProvider } from './roomConfigContext';
import { ThemeProvider, useTheme } from './themeContext';
import { isCognitoConfigured } from './amplifyConfig';

const AUTH_KEY = 'system1.auth.v1';
const AUTH_EMAIL_KEY = 'system1.auth.email.v1';
// ログイン方式('cognito'=実際のAmazon Cognito / 'mock'=Cognito未接続時 or
// 「ゲストとして続ける」でのデモ用ログイン)。ログアウト時にAmplifyの`signOut()`を
// 呼ぶべきかどうかの判定に使う。
const AUTH_MODE_KEY = 'system1.auth.mode.v1';

// ===================================================================
// アプリ全体のシェル。
// 【Role C: フロントエンド＆3Dモジュール 仕様書との対応】
// 用語・構成の対応はROLE_C_SPEC_ALIGNMENT.md(リポジトリ直下)を参照。
// このコンポーネント(Root)が仕様書 Step 1「Cognito認証(ログインUI)」の
// 「ルーティングを保護し、未ログイン時はダッシュボードへのアクセスを弾き
// ログイン画面へリダイレクトさせる」に対応する認証ゲートを担う。
// client/.env にCognitoの環境変数が設定されている場合は、起動時に
// Amplifyの`getCurrentUser()`で既存のCognitoセッション(トークン)の
// 有無を確認し、有効なセッションがあれば自動的にログイン状態にする。
// 環境変数が未設定の場合は、従来通りlocalStorageの認証フラグによる
// モック実装にフォールバックする(詳細はROLE_C_SPEC_ALIGNMENT.md参照)。
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
//     7. 危険行為の履歴        … 転倒・危険エリア侵入の履歴一覧とヒートマップ(仕様書Step 5)
//     8. YOLOの起動・動作確認  … Webカメラ/動画・2Dオーバーレイ・生データ確認
//     9. Polycamの動作確認     … スキャンしたGLTF/GLBの読み込み確認、間取り図画像の確認
//
// 【重要】ログイン画面(LoginPage)は家庭内利用向けのプロトタイプのため、実際の
// 認証は行っていない。メールアドレス・パスワードを入力するUIはあるが、
// 「ログイン」ボタンを押すと入力内容に関わらず常にログインが成功する。
// ログイン状態はlocalStorageに保存し、ブラウザを閉じても保持される。
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
  const [authed, setAuthed] = useState(() => {
    try { return window.localStorage.getItem(AUTH_KEY) === '1'; } catch { return false; }
  });
  const [userEmail, setUserEmail] = useState(() => {
    try { return window.localStorage.getItem(AUTH_EMAIL_KEY) || ''; } catch { return ''; }
  });
  const [authMode, setAuthMode] = useState(() => {
    try { return window.localStorage.getItem(AUTH_MODE_KEY) || 'mock'; } catch { return 'mock'; }
  });
  // Cognitoの既存セッション確認が終わるまでの一瞬だけ、ログイン画面の
  // ちらつき(一瞬ログイン画面→すぐダッシュボード)を防ぐための状態。
  const [checkingSession, setCheckingSession] = useState(isCognitoConfigured);

  // 起動時、Cognitoが設定されていれば既存のログインセッション(Amplifyが
  // localStorageに保持しているトークン)が有効かどうかを確認する。
  // 有効なセッションがあれば、ログイン画面を経由せず自動的にダッシュボードへ入る。
  useEffect(() => {
    if (!isCognitoConfigured) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setUserEmail(user?.signInDetails?.loginId || user?.username || '');
        setAuthMode('cognito');
        setAuthed(true);
      } catch {
        // 有効なセッションが無ければ、これまで通りログイン画面を表示する
        // (localStorageのモックフラグが残っていた場合は不整合なので消しておく)。
        if (!cancelled) {
          try { window.localStorage.removeItem(AUTH_KEY); } catch { /* noop */ }
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = (payload, remember) => {
    const email = payload?.email || '';
    const mode = payload?.mode || 'mock';
    setUserEmail(email);
    setAuthMode(mode);
    setAuthed(true);
    // 「ログイン状態を保持する」のチェックが外れている場合はlocalStorageに書かず、
    // このタブのメモリ上だけでログイン状態を保持する(再読み込みすると再度ログインが必要)。
    // ただし実際のCognitoログイン(mode==='cognito')の場合、Amplify自身が
    // トークンをlocalStorageに保存する仕様のため、このチェックに関わらず
    // 次回起動時は上のuseEffectで自動的に再ログインされる。
    if (remember) {
      try {
        window.localStorage.setItem(AUTH_KEY, '1');
        window.localStorage.setItem(AUTH_EMAIL_KEY, email || '');
        window.localStorage.setItem(AUTH_MODE_KEY, mode);
      } catch { /* 保存できなくても致命的ではないため無視 */ }
    }
  };

  const handleLogout = () => {
    if (authMode === 'cognito') {
      // Amplifyが保持しているCognitoトークンも破棄する(失敗しても画面上は
      // ログアウト扱いにする)。
      signOut().catch(() => { /* noop */ });
    }
    setAuthed(false);
    try {
      window.localStorage.removeItem(AUTH_KEY);
      window.localStorage.removeItem(AUTH_EMAIL_KEY);
      window.localStorage.removeItem(AUTH_MODE_KEY);
    } catch { /* noop */ }
  };

  if (checkingSession) {
    // Cognitoの既存セッション確認中(通常は一瞬で終わる)。ログイン画面が
    // 一瞬だけ表示されてすぐダッシュボードに切り替わる「ちらつき」を防ぐための
    // ごく簡易な待機表示。
    return <SessionCheckingScreen />;
  }
  if (!authed) {
    return <LoginPage onLogin={handleLogin} />;
  }
  return <AppShell userEmail={userEmail} authMode={authMode} onLogout={handleLogout} />;
}

function SessionCheckingScreen() {
  const { theme } = useTheme();
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.pageBg,
        color: theme.textFaint,
        fontFamily: 'sans-serif',
        fontSize: 13,
      }}
    >
      ログイン状態を確認しています…
    </div>
  );
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

  // 転倒検知・危険エリア侵入・開閉センサーの通知などの評価は、ここ(常時マウントの
  // AppShell)で行う。以前は見守りダッシュボード側で呼び出していたため、他の設定
  // タブを見ている間は評価そのものが止まってしまっていた(「今表示しているページ
  // だけをマウントする」というパフォーマンス対策の副作用。詳細はMonitoringDashboard.jsx
  // 冒頭のコメント参照)。ここで呼び出すことで、どのページを見ていても危険通知が
  // 途切れなくなる。
  const monitoringAlerts = useMonitoringAlerts(poseData, lastPoseAt, connected);

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
      </div>
    </div>
  );
}
