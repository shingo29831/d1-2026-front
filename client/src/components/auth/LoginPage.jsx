import React, { useMemo, useState } from 'react';
import { signIn } from 'aws-amplify/auth';
import { useTheme } from '../../themeContext';
import { isCognitoConfigured } from '../../amplifyConfig';
import { describeCognitoError } from '../../cognitoErrors';

// ログイン画面。アイコン・装飾は一切使わず、ラベル・入力欄・ボタンだけの
// とてもシンプルな構成にしている。
// 【Role C仕様書 Step 1「Cognito認証(ログインUI)」との対応】
// client/.env に実際のCognito User Pool ID等が設定されている場合(isCognitoConfigured
// がtrue)は、`aws-amplify` の`signIn`で実際のAmazon Cognitoに対して認証する。
// 環境変数が未設定の場合(このリポジトリを初めて開いた直後など)は、従来通り
// 「常にログイン成功」のモック認証にフォールバックする(詳細はROLE_C_SPEC_ALIGNMENT.md参照)。
//
// 【重要・パスワードの扱いについて】このファイルや他のどのファイルにも、
// 実際のテスト用パスワードを直接書き込んではいけない。ログインフォームの
// パスワード入力欄はあくまで人がその場で入力するためのものであり、
// Amplifyの`signIn({ username, password })`もその場で渡された値をその場でしか
// 使わない(保存されない)。
//
// 「ログイン状態を保持する」のチェックを外すと、ブラウザを閉じる(タブを閉じる/
// 再読み込みする)と再度ログインが必要になる(localStorageのフラグに保存しないため。
// ただしAmplify自体はCognitoのトークンを独自にlocalStorageへ保存する仕様のため、
// 実際のCognitoログイン時はこのチェックの有無に関わらずAmplify側のセッションは
// 残る点に注意。App.jsxのRootコンポーネントも参照)。
//
// 「ゲストとして続ける」は、Cognitoとは無関係のオフライン/デモ用モックログイン
// (このAIの開発サンドボックスのようにAWSへ通信できない環境での確認用)。
export default function LoginPage({ onLogin }) {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const s = useMemo(() => makeStyles(theme), [theme]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isCognitoConfigured) {
      // Cognitoの環境変数が無い場合は、これまで通りのモック認証(常にログイン成功)。
      setSubmitting(true);
      onLogin({ email: email.trim(), mode: 'mock' }, remember);
      return;
    }

    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードの両方を入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      const { isSignedIn, nextStep } = await signIn({
        username: email.trim(),
        password,
      });
      if (isSignedIn) {
        onLogin({ email: email.trim(), mode: 'cognito' }, remember);
      } else {
        setError(
          `追加の手続きが必要なため、この画面だけではログインできません` +
          `(${nextStep?.signInStep || '不明な手順'})。管理者にご確認ください。`,
        );
        setSubmitting(false);
      }
    } catch (err) {
      setError(describeCognitoError(err));
      setSubmitting(false);
    }
  };

  return (
    <div style={s.backdrop}>
      <div style={s.card}>
        <h1 style={s.title}>ログイン</h1>
        <p style={s.subtitle}>子供見守りシステム</p>

        <form onSubmit={handleSubmit} style={s.form}>
          {error && <p style={s.errorNote}>{error}</p>}

          <label style={s.label}>
            メールアドレス
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={s.input}
              autoComplete="username"
            />
          </label>

          <label style={s.label}>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=""
              style={s.input}
              autoComplete="current-password"
            />
          </label>

          <label style={s.rememberRow}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={s.checkbox}
            />
            ログイン状態を保持する
          </label>

          <button type="submit" style={s.submitBtn} disabled={submitting}>
            ログイン
          </button>

          <button
            type="button"
            style={s.guestBtn}
            onClick={() => onLogin({ email: '', mode: 'mock' }, remember)}
          >
            ゲストとして続ける(デモ用・認証なし)
          </button>
        </form>

        <p style={s.note}>
          {isCognitoConfigured
            ? '※ 「ログイン」はAmazon Cognitoに実際に接続して認証します。「ゲストとして続ける」はCognitoを介さないデモ用のログインです。'
            : '※ これは家庭内利用向けのプロトタイプ画面です(Cognito未接続のため入力内容に関わらずログインできます)。'}
        </p>
      </div>
    </div>
  );
}

function makeStyles(theme) {
  return {
    backdrop: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.pageBg,
      fontFamily: 'sans-serif',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      background: theme.panelBg,
      border: `1px solid ${theme.border}`,
      borderRadius: 10,
      padding: '32px 28px',
    },
    title: { margin: '0 0 4px', fontSize: 19, color: theme.textStrong, fontWeight: 700 },
    subtitle: { margin: '0 0 24px', fontSize: 12.5, color: theme.textFaint },
    form: { display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' },
    label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: theme.textMuted, fontWeight: 600 },
    input: {
      width: '100%',
      background: theme.inputBg,
      border: `1px solid ${theme.borderSoft}`,
      borderRadius: 6,
      color: theme.text,
      padding: '10px 11px',
      fontSize: 14,
      boxSizing: 'border-box',
    },
    rememberRow: {
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.textMuted,
      fontWeight: 500, cursor: 'pointer', userSelect: 'none',
    },
    checkbox: { width: 15, height: 15, accentColor: theme.accent, cursor: 'pointer' },
    submitBtn: {
      marginTop: 4,
      padding: '11px 16px',
      fontSize: 14,
      fontWeight: 700,
      background: theme.accent,
      color: theme.mode === 'dark' ? '#04222a' : '#ffffff',
      border: `1px solid ${theme.accentBorder}`,
      borderRadius: 6,
      cursor: 'pointer',
    },
    guestBtn: {
      padding: '10px 16px',
      fontSize: 13,
      fontWeight: 600,
      background: 'transparent',
      color: theme.textMuted,
      border: `1px solid ${theme.borderSoft}`,
      borderRadius: 6,
      cursor: 'pointer',
    },
    note: { marginTop: 20, fontSize: 10.5, color: theme.textFaint, lineHeight: 1.6, textAlign: 'center' },
    errorNote: {
      margin: 0,
      fontSize: 12.5,
      color: theme.danger,
      background: theme.mode === 'dark' ? 'rgba(244,63,94,0.1)' : 'rgba(244,63,94,0.08)',
      border: `1px solid ${theme.danger}`,
      borderRadius: 6,
      padding: '9px 11px',
      lineHeight: 1.5,
    },
  };
}
