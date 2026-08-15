// ===================================================================
// AmplifyのsignIn()/fetchAuthSession()等が投げるエラーは英語のエラー名
// (err.name)しか付いてこないことが多いので、日本語の説明文に変換する。
//
// 元々はLoginPage.jsxの中だけに定義されていたが、新しく作った「接続状況」
// 診断ページ(ConnectionStatusPage.jsx)でも同じエラーを同じ文言で表示したい
// ため、共通ファイルとして切り出した。ロジックの変更は無い(そのまま移動)。
// ===================================================================
export function describeCognitoError(err) {
  const name = err && err.name;
  switch (name) {
    case 'UserNotFoundException':
    case 'NotAuthorizedException':
      return 'メールアドレスまたはパスワードが正しくありません。';
    case 'UserNotConfirmedException':
      return 'このアカウントはまだ確認(メール認証等)が完了していません。管理者にご確認ください。';
    case 'UserAlreadyAuthenticatedException':
      return '既にログイン済みのセッションが残っています。一度ページを再読み込みしてからお試しください。';
    case 'NetworkError':
      return 'ネットワークエラーによりCognitoへ接続できませんでした。インターネット接続をご確認ください。';
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return '試行回数が多すぎます。しばらく待ってからもう一度お試しください。';
    default:
      return `ログインに失敗しました${err && err.message ? `(${err.message})` : ''}。`;
  }
}
