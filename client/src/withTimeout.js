// ===================================================================
// ネットワーク呼び出しが「固まったまま何も起きない」状態を防ぐための、
// 汎用のタイムアウト付きPromiseラッパー。
//
// 【背景】ブラウザ標準のfetch()やAmplifyのfetchAuthSession()は、既定では
// タイムアウトが無い(サーバーが応答を返さない限り、成功も失敗もせず
// ずっと待ち続けてしまうことがある)。特にfetchAuthSession()はCognito
// Identity Poolから一時AWSクレデンシャルを取得しようとする際に、社内
// ネットワーク/VPN/ファイアウォールの制限などでAWSのSTSエンドポイントへ
// の通信が(エラーにもならず)応答無しのまま止まってしまうことがあり、
// その場合「確認中…」の表示のまま永久に止まって見えてしまう。
//
// この関数は、指定ミリ秒以内に元のPromiseが決着しなければ代わりに
// reject するため、呼び出し側は必ず一定時間内に結果(成功 or タイムアウト
// エラー)を受け取れるようになる。
// 【注意】これは「待つのをやめる」だけであり、元のPromise(実際の通信)
// 自体を中断するものではない(fetch()のAbortControllerのような本当の
// キャンセルではない)。バックグラウンドで通信が続く可能性はあるが、
// UI側が固まって見える問題は解消できる。
export function withTimeout(promise, ms, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage || `タイムアウトしました(${Math.round(ms / 1000)}秒)`)), ms);
    }),
  ]);
}
