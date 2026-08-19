import React, { useMemo, useState } from 'react';
import { signIn } from 'aws-amplify/auth';
import { useTheme } from '../../themeContext';
import { isCognitoConfigured } from '../../amplifyConfig';
import { describeCognitoError } from '../../cognitoErrors';
import { FONT_FAMILY } from '../../fontFamily';

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
// 【重要】以前は「ログイン状態を保持する」チェックボックスがあり、ONにすると
// localStorageへ認証フラグを保存してブラウザを閉じてもログインしたままに
// できたが、「サイトを開いたら必ずログイン画面から始まるようにしてほしい」
// との要望を受けて廃止した。ログイン状態はApp.jsx側でReactのstateのみとして
// 保持するため、ページの再読み込みやブラウザを開き直すと必ずこの画面に戻る
// (App.jsxのRootコンポーネントも参照)。
//
// 「ゲストとして続ける」は、Cognitoとは無関係のオフライン/デモ用モックログイン
// (このAIの開発サンドボックスのようにAWSへ通信できない環境での確認用)。
export default function LoginPage({ onLogin }) {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // 【2026-08-19further変更】「パスワードを打った時に見えないので見えるように
  // してほしい」というご要望への対応。既定は今まで通りマスク表示(●●●)にして
  // おき、右側の「表示」ボタンを押した間だけ平文表示に切り替えられるようにする
  // (押しっぱなしにする必要はなく、トグル式でON/OFFする)。
  const [showPassword, setShowPassword] = useState(false);

  const s = useMemo(() => makeStyles(theme), [theme]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isCognitoConfigured) {
      // Cognitoの環境変数が無い場合は、これまで通りのモック認証(常にログイン成功)。
      setSubmitting(true);
      onLogin({ email: email.trim(), mode: 'mock' });
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
        onLogin({ email: email.trim(), mode: 'cognito' });
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
    <div className="s1-login-backdrop" style={s.backdrop}>
      {/* 【2026-08-19further変更・不具合修正】「スマホ画面になったときに画面に
          収まらない」というご報告への対応。以前はheight:'100vh'固定にしていたが、
          スマホでパスワード欄をタップして画面キーボードが開くと、多くの
          ブラウザでは`100vh`が「キーボードで隠れる前の全体の高さ」のまま
          変わらない(実際に見えている範囲より大きい)ため、overflow:'hidden'と
          組み合わさってフォームの下側がキーボードの裏に隠れたまま、
          スクロールもできずに「見えない・収まらない」状態になっていた。
          対応として、React styleオブジェクトでは1つのプロパティに複数の
          フォールバック値を書けない(後勝ちで上書きされてしまう)ため、
          ここだけ通常のCSS(<style>タグ)で定義し、
            height: 100vh;             ← dvh未対応の古いブラウザ向け
            height: 100dvh;            ← 対応ブラウザではキーボード分を
                                          差し引いた実際の表示高さに追従する
            overflow: hidden;          ← 横方向は常に固定(スクロールさせない)
            overflow-y: auto;          ← 縦方向だけは、万一それでも収まりきら
                                          ない場合の保険としてスクロール可能に
                                          しておく(普段は中身が収まるため
                                          実際にスクロールバーは出ない)
          という優先順位で指定している。 */}
      <style>{`
        .s1-login-backdrop {
          height: 100vh;
          height: 100dvh;
          overflow: hidden;
          overflow-y: auto;
        }
      `}</style>
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
            {/* 【不具合修正】パスワード入力欄の右側に「表示」ボタンを追加し、
                押すとinputのtypeを'password'⇔'text'に切り替えて、今何を
                入力しているか目で確認できるようにする。ボタン分の余白を
                確保するため、入力欄のpadding-rightだけ広めに取っている。 */}
            <div style={s.passwordWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                style={s.passwordInput}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={s.passwordToggleBtn}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showPassword ? '隠す' : '表示'}
              </button>
            </div>
          </label>

          <button type="submit" style={s.submitBtn} disabled={submitting}>
            ログイン
          </button>

          <button
            type="button"
            style={s.guestBtn}
            onClick={() => onLogin({ email: '', mode: 'mock' })}
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
    // 【2026-08-19further変更】「スマホになるとログイン画面が縦スクロール
    // できるようになっているのでできないようにして、ログインフォームを
    // 画面の中央に表示してほしい」というご要望への対応。以前はminHeight:
    // '100vh'だったため、画面が低い機種では100vhを超えてページ全体が
    // 縦スクロールしてしまい、フォームが常に中央に見えるとは限らなかった。
    // 【2026-08-19further2変更】height・overflowの実際の値は、キーボード
    // 表示時にも追従できるよう上の<style>タグ(className="s1-login-backdrop")
    // 側で指定するようにしたため、ここでは指定しない(inline styleの方が
    // 優先度が高く、指定してしまうと<style>タグの内容を上書きしてしまう
    // ため)。万一きわめて縦が短い画面でフォームが収まりきらない場合の保険
    // として、カード側にmaxHeight+overflowY:'auto'を付けている(その場合も
    // ページ全体ではなくカードの中だけがスクロールする)。
    backdrop: {
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.pageBg,
      fontFamily: FONT_FAMILY,
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      maxHeight: '100%',
      overflowY: 'auto',
      boxSizing: 'border-box',
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
    // 【不具合修正】パスワード入力欄の右側に「表示」ボタンを重ねて置くための
    // ラッパー(position:relative)。ボタン自体はabsoluteでこの中の右端に
    // 配置する。
    passwordWrap: { position: 'relative', width: '100%' },
    passwordInput: {
      width: '100%',
      background: theme.inputBg,
      border: `1px solid ${theme.borderSoft}`,
      borderRadius: 6,
      color: theme.text,
      padding: '10px 52px 10px 11px', // 右側だけ「表示」ボタン分の余白を広めに確保
      fontSize: 14,
      boxSizing: 'border-box',
    },
    passwordToggleBtn: {
      position: 'absolute',
      top: '50%',
      right: 6,
      transform: 'translateY(-50%)',
      border: 'none',
      background: 'transparent',
      color: theme.accent,
      fontSize: 11.5,
      fontWeight: 700,
      cursor: 'pointer',
      padding: '4px 6px',
      borderRadius: 4,
    },
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
