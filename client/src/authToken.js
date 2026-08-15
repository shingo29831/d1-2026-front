// ===================================================================
// ログイン中のユーザーのCognito IDトークンを取得する共通ヘルパー。
// 【Role C仕様書 Step 5「履歴API(JWTトークン付き)からのデータ取得」との対応】
// historyApi.js がこのファイルを使って `Authorization: Bearer <IDトークン>`
// ヘッダーを組み立てる。将来IoT Core接続(iotClient.js)でも一時AWSクレデンシャル
// (アクセスキー等)を同じ`fetchAuthSession()`から取得する。
//
// Cognitoが未設定/未ログイン/セッション切れなど、トークンを取得できない場合は
// 例外を投げずに null を返す(呼び出し側でAuthorizationヘッダーを付けずに
// リクエストする=モックAPI側が未認証アクセスを許容している場合のフォールバック、
// または呼び出し側でモックデータにフォールバックする)。
import { fetchAuthSession } from 'aws-amplify/auth';
import { isCognitoConfigured } from './amplifyConfig';
import { withTimeout } from './withTimeout';

// 【重要】fetchAuthSession()は既定でタイムアウトが無いため、ネットワーク環境
// によっては応答が無いまま止まってしまうことがある(withTimeout.js参照)。
// 10秒以内に決着しなければタイムアウトエラーとして扱い、下のcatchでnullを
// 返す(=Authorizationヘッダー無しでのフォールバック動作になる)ようにして、
// 呼び出し元の画面が「読み込み中」のまま固まって見える事態を防いでいる。
export async function getIdToken() {
  if (!isCognitoConfigured) return null;
  try {
    const session = await withTimeout(fetchAuthSession(), 10000, 'fetchAuthSessionがタイムアウトしました');
    const token = session?.tokens?.idToken;
    return token ? token.toString() : null;
  } catch {
    return null;
  }
}
