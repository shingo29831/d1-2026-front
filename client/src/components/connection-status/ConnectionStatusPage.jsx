import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useTheme } from '../../themeContext';
import { isCognitoConfigured, AWS_REGION } from '../../amplifyConfig';
import { describeCognitoError } from '../../cognitoErrors';
import { fetchIncidentsSortedDesc } from '../../historyApi';
import { getSignedIotWebSocketUrl } from '../../iotClient';
import { withTimeout } from '../../withTimeout';

// ===================================================================
// 「接続状況」診断ページ。
//
// 目的: AWS(Cognito・IoT Core・履歴API・S3)や、検出パイプライン(Webカメラ/
// 見守りサーバー)との接続状況を、この1画面を見るだけでひと目で把握できる
// ようにする。ユーザーからの依頼:
//   「awsの接続状況やCiscoのカメラとの接続状況などがわかるように新しいタブを
//    作成してどのような状況かわかるようなGUIを作成してほしいです」
//
// 【重要・設計上の注意】
// このアプリ(フロントエンド)は、実際のCisco Meraki MVカメラには一切
// 直接接続していない。仕様書(https://d1-docs.pages.dev/)上、カメラ映像の
// AI解析やMerakiとの連携はRole A(クラウド/AI側)の担当範囲であり、
// フロントエンドが受け取るのはRole Aが解析した後の結果(IoT Core経由の
// JSON、または履歴API)のみ。そのため、このページの「カメラ」欄は
// 実際のMerakiカメラの生死ではなく、①このブラウザ自身のWebカメラ(検出の
// デモ・動作確認用)と、②見守りサーバー(Socket.IO、pose-data配信元)との
// 接続状況を表示している。誤解を防ぐため、その旨をページ内に明記している。
//
// 各セクションの確認方法:
//   ・Cognito     : ページ表示時に自動でfetchAuthSession()を呼び、有効な
//                   IDトークンを取得できるか確認する。
//   ・IoT Core    : 手動の「接続テスト」ボタン。実際にAWS IoT CoreへMQTT over
//                   WebSocketで接続を試み(SigV4署名はiotClient.jsを利用)、
//                   接続できるか/エラーになるかを確認する(最大10秒待機)。
//                   自動実行にしていない理由: Cognitoの一時クレデンシャルが
//                   必要な上、ネットワーク環境によっては接続確立(または
//                   タイムアウト)までに数秒かかることがあるため。
//   ・履歴API     : ページ表示時に自動でfetchIncidentsSortedDesc()を呼び、
//                   実データ('api')かサンプルデータへのフォールバック('mock')
//                   かを確認する(historyApi.js内で通信エラー時は自動的に
//                   サンプルデータへフォールバックする仕様のため、通信自体が
//                   失敗しても画面が壊れることは無い)。
//   ・S3/デプロイ  : ライブでの接続確認はできない(ブラウザからS3へ書き込み
//                   確認する手段が無いため)。設定値の表示のみ。
//   ・検出パイプライン: useDetectionPipeline()が返す状態(App.jsxから
//                   props経由で受け取る)をそのまま表示する。
export default function ConnectionStatusPage({
  authMode,
  userEmail,
  connected,
  cameraError,
  shouldCapture,
  requestWebcam,
  lastPoseAt,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const HISTORY_API_URL = import.meta.env.VITE_HISTORY_API_URL || '';
  const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT || '';

  // --- Cognito(自動確認) ---
  const [cognitoStatus, setCognitoStatus] = useState({ state: 'checking', message: '確認中…' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isCognitoConfigured) {
        if (!cancelled) {
          setCognitoStatus({
            state: 'unconfigured',
            message: 'client/.env にCognitoの環境変数(VITE_AWS_REGION等)が設定されていません。モック認証で動作しています。',
          });
        }
        return;
      }
      setCognitoStatus({ state: 'checking', message: '確認中…(最大10秒待機します)' });
      try {
        // 【重要】fetchAuthSession()は既定でタイムアウトが無く、ネットワーク環境に
        // よっては応答無しのまま止まってしまうことがあるため、withTimeout()で
        // 10秒の上限を設けている(この画面が「確認中…」のまま永久に固まって
        // 見えないようにするための対策。withTimeout.js参照)。
        const session = await withTimeout(fetchAuthSession(), 10000, 'TIMEOUT');
        if (cancelled) return;
        const idToken = session?.tokens?.idToken;
        if (idToken) {
          setCognitoStatus({ state: 'ok', message: 'Cognitoに接続し、有効なIDトークンを取得できています。' });
        } else {
          setCognitoStatus({
            state: 'warning',
            message: 'Cognitoの設定は有効ですが、ログインセッションのトークンが見つかりませんでした(ゲストログイン中の可能性があります)。',
          });
        }
      } catch (err) {
        if (cancelled) return;
        if (err && err.message === 'TIMEOUT') {
          setCognitoStatus({
            state: 'error',
            message: 'Cognito/Identity Poolへの問い合わせがタイムアウトしました(10秒)。社内ネットワーク/VPN等の制限でAWSのSTSエンドポイントに到達できていない可能性があります。',
          });
        } else {
          setCognitoStatus({ state: 'error', message: describeCognitoError(err) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- 履歴API(自動確認) ---
  const [historyStatus, setHistoryStatus] = useState({ state: 'checking', message: '確認中…' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryStatus({ state: 'checking', message: '確認中…' });
      const { incidents, source, error } = await fetchIncidentsSortedDesc();
      if (cancelled) return;
      if (source === 'api') {
        setHistoryStatus({ state: 'ok', message: `履歴APIから実データを取得できました(${incidents.length}件)。`, source });
      } else if (error) {
        setHistoryStatus({
          state: 'error',
          message: `履歴APIへの接続に失敗したため、サンプルデータを表示中です(${error})。`,
          source,
        });
      } else {
        setHistoryStatus({
          state: 'unconfigured',
          message: 'VITE_HISTORY_API_URLが未設定のため、サンプルデータを表示中です。',
          source,
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- IoT Core(手動テスト) ---
  const [iotStatus, setIotStatus] = useState({ state: 'idle', message: 'まだ確認していません。' });
  const [iotTesting, setIotTesting] = useState(false);

  const testIotCore = useCallback(async () => {
    if (!IOT_ENDPOINT) {
      setIotStatus({ state: 'error', message: 'VITE_IOT_ENDPOINTが設定されていません(client/.env を確認してください)。' });
      return;
    }
    if (!isCognitoConfigured) {
      setIotStatus({ state: 'error', message: 'Cognitoが未設定のため、IoT Core接続用のAWS一時クレデンシャルを取得できません。' });
      return;
    }

    setIotTesting(true);
    setIotStatus({ state: 'checking', message: '接続中…(最大10秒待機します)' });

    let client = null;
    let settled = false;
    const finish = (next) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setIotStatus(next);
      setIotTesting(false);
      try { client?.end(true); } catch { /* noop */ }
    };

    const timeoutId = setTimeout(() => {
      finish({
        state: 'error',
        message: '接続がタイムアウトしました(10秒)。ネットワーク環境(このAI開発環境はAWSへ外部通信できません)や、IoT Coreのポリシー設定をご確認ください。',
      });
    }, 10000);

    try {
      const url = await getSignedIotWebSocketUrl();
      const mqtt = await import('mqtt');
      client = mqtt.connect(url, {
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 10000,
        clientId: `system1-web-status-${Math.random().toString(16).slice(2)}`,
      });
      client.once('connect', () => {
        finish({ state: 'ok', message: 'AWS IoT Coreへの接続に成功しました。' });
      });
      client.once('error', (err) => {
        finish({ state: 'error', message: `接続エラー: ${err && err.message ? err.message : String(err)}` });
      });
    } catch (err) {
      finish({ state: 'error', message: err && err.message ? err.message : String(err) });
    }
  }, [IOT_ENDPOINT]);

  return (
    <div style={{ padding: '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0, color: theme.textStrong, fontSize: 22 }}>接続状況</h2>
      <p style={{ color: theme.textMuted, maxWidth: 1000, lineHeight: 1.7, fontSize: 14.5 }}>
        AWS(Cognito・IoT Core・履歴API)および検出パイプライン(Webカメラ・見守りサーバー)との
        接続状況をまとめて確認できるページです。
      </p>

      <div style={styles.grid}>
        {/* Cognito */}
        <section style={styles.card}>
          <div style={styles.cardHeadRow}>
            <h3 style={styles.cardTitle}>① AWS Cognito(ログイン認証)</h3>
            <StatusBadge state={cognitoStatus.state} theme={theme} />
          </div>
          <p style={styles.cardDesc}>{cognitoStatus.message}</p>
          <dl style={styles.infoList}>
            <Info label="現在のログイン方式" value={authMode === 'cognito' ? 'Cognito(実認証)' : 'モック/ゲスト'} theme={theme} />
            <Info label="ログイン中のユーザー" value={userEmail || '(未設定・ゲスト)'} theme={theme} />
            <Info label="リージョン" value={AWS_REGION || '(未設定)'} theme={theme} />
            <Info label="環境変数(client/.env)" value={isCognitoConfigured ? '設定済み' : '未設定'} theme={theme} />
          </dl>
        </section>

        {/* IoT Core */}
        <section style={styles.card}>
          <div style={styles.cardHeadRow}>
            <h3 style={styles.cardTitle}>② AWS IoT Core(MQTT・リアルタイム通知)</h3>
            <StatusBadge state={iotStatus.state} theme={theme} />
          </div>
          <p style={styles.cardDesc}>{iotStatus.message}</p>
          <dl style={styles.infoList}>
            <Info label="エンドポイント" value={IOT_ENDPOINT || '(未設定)'} theme={theme} />
            <Info label="配線状況" value="準備コードのみ(実配信トピック未受領のためUIには未接続)" theme={theme} />
          </dl>
          <button style={styles.testBtn} onClick={testIotCore} disabled={iotTesting}>
            {iotTesting ? '接続テスト中…' : '接続テストを実行'}
          </button>
        </section>

        {/* 履歴API */}
        <section style={styles.card}>
          <div style={styles.cardHeadRow}>
            <h3 style={styles.cardTitle}>③ 履歴API(危険行為の履歴取得)</h3>
            <StatusBadge state={historyStatus.state} theme={theme} />
          </div>
          <p style={styles.cardDesc}>{historyStatus.message}</p>
          <dl style={styles.infoList}>
            <Info label="API URL" value={HISTORY_API_URL || '(未設定)'} theme={theme} />
            <Info label="データソース" value={historyStatus.source === 'api' ? '実データ(API)' : 'サンプルデータ(モック)'} theme={theme} />
          </dl>
        </section>

        {/* S3/デプロイ */}
        <section style={styles.card}>
          <div style={styles.cardHeadRow}>
            <h3 style={styles.cardTitle}>④ S3(本番デプロイ先)</h3>
            <StatusBadge state="unconfigured" theme={theme} label="未実行" />
          </div>
          <p style={styles.cardDesc}>
            ブラウザからS3への書き込み状況を直接確認する手段は無いため、ここは設定値の表示のみです。
            デプロイはAWS CLIの権限を持つ端末で <code>deploy-s3.sh</code>(または <code>deploy-s3.bat</code>)を
            実行してください(このAI開発環境はAWSへの外部通信ができないため、まだ実行できていません)。
          </p>
          <dl style={styles.infoList}>
            <Info label="バケット名" value="cisco-sin-frontend-966042698775-ap-southeast-1-an" theme={theme} />
            <Info label="リージョン" value="ap-southeast-1" theme={theme} />
          </dl>
        </section>

        {/* 検出パイプライン(説明文が長いため3列ぶん=全幅を使う) */}
        <section style={{ ...styles.card, gridColumn: '1 / -1' }}>
          <div style={styles.cardHeadRow}>
            <h3 style={styles.cardTitle}>⑤ 検出パイプライン(Webカメラ・見守りサーバー)</h3>
            <StatusBadge state={connected ? 'ok' : 'error'} theme={theme} label={connected ? '接続中' : '未接続'} />
          </div>
          <p style={styles.cardDesc}>
            <strong>【重要】</strong>このアプリ(フロントエンド)は、実際のCisco Meraki MVカメラには直接
            接続していません。カメラ映像のAI解析はRole A(クラウド/AI側)の担当範囲であり、フロントエンドは
            解析後の結果(IoT Core・履歴API経由)を受け取る想定です。現時点ではその配線が未完了のため、
            代わりにこのブラウザ自身のWebカメラを見守りサーバー(Socket.IO)へ送信し、動作確認用の
            検出デモとして使っています。以下はその「Webカメラ ⇔ 見守りサーバー」の接続状況です。
          </p>
          <dl style={styles.infoList}>
            <Info label="見守りサーバー(Socket.IO)" value={connected ? '接続中' : '未接続'} theme={theme} />
            <Info label="キャプチャモード" value={shouldCapture ? '有効(このタブからカメラ映像を送信)' : '閲覧専用(?view=1等でアクセス中)'} theme={theme} />
            <Info label="Webカメラ" value={cameraError ? `エラー: ${cameraError}` : (shouldCapture ? '起動中/起動試行済み' : '(閲覧専用のため未起動)')} theme={theme} />
            <Info
              label="最終検出データ受信"
              value={lastPoseAt ? `${Math.round((Date.now() - lastPoseAt) / 1000)}秒前` : 'まだ受信していません'}
              theme={theme}
            />
          </dl>
          {shouldCapture && (
            <button style={styles.testBtn} onClick={requestWebcam}>
              Webカメラを再試行
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function Info({ label, value, theme }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${theme.borderSoft}` }}>
      <dt style={{ color: theme.textFaint }}>{label}</dt>
      <dd style={{ margin: 0, color: theme.textMuted, textAlign: 'right', wordBreak: 'break-all' }}>{value}</dd>
    </div>
  );
}

function StatusBadge({ state, theme, label }) {
  const map = {
    ok: { color: theme.accent, bg: theme.accentSoft, text: label || '接続OK' },
    warning: { color: theme.warning, bg: theme.mode === 'dark' ? 'rgba(245,158,11,0.12)' : 'rgba(217,119,6,0.1)', text: label || '要確認' },
    error: { color: theme.danger, bg: theme.mode === 'dark' ? 'rgba(244,63,94,0.1)' : 'rgba(220,38,38,0.08)', text: label || '未接続' },
    checking: { color: theme.textFaint, bg: theme.panelBgAlt, text: label || '確認中…' },
    unconfigured: { color: theme.textFaint, bg: theme.panelBgAlt, text: label || '未設定' },
    idle: { color: theme.textFaint, bg: theme.panelBgAlt, text: label || '未確認' },
  };
  const s = map[state] || map.idle;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.color}`,
        borderRadius: 999,
        padding: '3px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {s.text}
    </span>
  );
}

function makeStyles(theme) {
  return {
    // 他の設定画面(部屋の設定など)と統一感を持たせるため、カードは3列のグリッドに並べる。
    grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 8 },
    card: {
      background: theme.panelBg,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      padding: 20,
      minWidth: 0,
    },
    cardHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
    cardTitle: { margin: 0, fontSize: 15, color: theme.textStrong },
    cardDesc: { fontSize: 12.5, color: theme.textMuted, lineHeight: 1.6, marginBottom: 12 },
    infoList: { margin: 0 },
    testBtn: {
      marginTop: 14,
      padding: '9px 16px',
      fontSize: 12.5,
      fontWeight: 600,
      background: theme.mode === 'dark' ? '#164e63' : theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
      borderRadius: 6,
      cursor: 'pointer',
    },
  };
}
