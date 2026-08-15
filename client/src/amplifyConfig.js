// ===================================================================
// AWS Amplify(Cognito認証)の初期設定。
// 【Role C仕様書 Step 1「Cognito認証」との対応】
// ROLE_C_SPEC_ALIGNMENT.md にある「Amplify Auth / Identity Poolからの
// 一時クレデンシャル取得」を実装したファイル。ここで設定した内容を使って、
// LoginPage.jsx が実際のAmazon Cognito User Poolに対してログインし、
// historyApi.js / iotClient.js が Identity Pool経由の一時AWSクレデンシャルや
// IDトークンを取得する。
//
// 値は client/.env (VITE_ プレフィックス)から読み込む。ユーザープールID・
// クライアントID・アイデンティティプールIDはいずれも「公開されても問題ない」
// 種類の識別子(フロントエンドのJSバンドルに埋め込まれる想定のもの)であり、
// パスワード等の秘密情報とは異なるためこの方法で問題ない。
//
// 【重要】client/.env が無い/値が空の環境(このリポジトリを初めて開いた直後や、
// このAIのサンドボックス環境のようにAWSへの外部通信ができない環境)でも
// アプリ自体は起動できるよう、必須の値が揃っていない場合はAmplifyの設定を
// スキップする(isCognitoConfigured=false)。この場合 LoginPage.jsx は
// 従来通りのモック認証(常にログイン成功)にフォールバックする。
import { Amplify } from 'aws-amplify';

const region = import.meta.env.VITE_AWS_REGION || '';
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID || '';
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID || '';
const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || '';

export const isCognitoConfigured = Boolean(region && userPoolId && userPoolClientId);

if (isCognitoConfigured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        // Identity PoolはIoT Core接続用の一時AWSクレデンシャル取得(iotClient.js)に必要。
        // 未設定でもUser Poolでのログイン自体は可能なため、空文字なら省略する。
        ...(identityPoolId ? { identityPoolId } : {}),
        loginWith: { email: true },
      },
    },
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[amplifyConfig] Cognitoの環境変数が未設定のため、実際のAWS認証は無効化されています' +
    '(client/.env のVITE_AWS_REGION / VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_IDを確認してください)。' +
    'ログイン画面はモック認証にフォールバックします。',
  );
}

export const AWS_REGION = region;
