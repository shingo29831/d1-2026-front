#!/usr/bin/env bash
# ===================================================================
# クライアント(React/Vite)をビルドして、S3バケットへアップロードするスクリプト。
# 【Role C仕様書 Step 6「プロダクションビルドとデプロイ」との対応】
#
# 【重要・実行前に必ずお読みください】
# このスクリプトはコード(下ごしらえ)のみ用意したものであり、AI(このセッション)
# の環境では実行できていません。理由は次の2点です。
#   1. このセッションの環境からAWSの各種エンドポイントへ外部通信ができない
#      (ネットワーク制限があるサンドボックス環境のため)。
#   2. S3への書き込み(アップロード)には、今回共有いただいたCognitoの
#      情報(ログイン用のUser Pool ID等)とは別に、"デプロイ実行者用の
#      AWS IAMクレデンシャル"(aws configureで設定するアクセスキー、または
#      同等の権限を持つロール)が必要ですが、これは共有されていません。
# そのため、実行はお客様側の、AWS CLIが使えてS3への書き込み権限を持つ
# 環境(Role Bの方の端末など)で行っていただく想定です。
#
# 事前準備:
#   1. AWS CLIをインストールし、`aws configure` でデプロイ用のアクセスキー/
#      シークレットキーを設定しておく(このバケットへの s3:PutObject /
#      s3:DeleteObject / s3:ListBucket 権限が必要)。
#   2. 下記 BUCKET / REGION の値が実際のものと合っているか確認する。
#
# 使い方:
#   ./deploy-s3.sh
# ===================================================================
set -euo pipefail

BUCKET="cisco-sin-frontend-966042698775-ap-southeast-1-an"
REGION="ap-southeast-1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="${SCRIPT_DIR}/client"

if ! command -v aws >/dev/null 2>&1; then
  echo "エラー: AWS CLIが見つかりません。先に https://aws.amazon.com/cli/ からインストールしてください。" >&2
  exit 1
fi

echo "== 1/3: 依存パッケージのインストール =="
(cd "${CLIENT_DIR}" && npm ci)

echo "== 2/3: プロダクションビルド (client/.env の VITE_ 変数がバンドルに埋め込まれます) =="
(cd "${CLIENT_DIR}" && npm run build)

echo "== 3/3: S3バケットへ同期 (s3://${BUCKET}) =="
aws s3 sync "${CLIENT_DIR}/dist" "s3://${BUCKET}" \
  --region "${REGION}" \
  --delete

echo ""
echo "完了しました。"
echo "※ CloudFrontを併用している場合は、キャッシュ更新のため以下のような"
echo "  invalidation(キャッシュ無効化)の実行も忘れずに行ってください:"
echo "    aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths '/*'"
echo "  (DISTRIBUTION_IDは今回共有されていないため、Role Bにご確認ください)"
