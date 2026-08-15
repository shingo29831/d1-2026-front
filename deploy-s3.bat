@echo off
REM ===================================================================
REM クライアント(React/Vite)をビルドして、S3バケットへアップロードするバッチファイル。
REM 【Role C仕様書 Step 6「プロダクションビルドとデプロイ」との対応】
REM restart.bat と同じく、ダブルクリックで実行できます。
REM
REM 【重要・実行前に必ずお読みください】
REM このバッチファイルはコード(下ごしらえ)のみ用意したものであり、AI(開発時の
REM セッション)の環境では実行できていません。理由は次の2点です。
REM   1. 開発時のセッションの環境からAWSの各種エンドポイントへ外部通信ができない。
REM   2. S3への書き込み(アップロード)には、今回共有いただいたCognitoの情報とは
REM      別に「デプロイ実行者用のAWS IAMクレデンシャル」(aws configureで設定する
REM      アクセスキー、または同等の権限を持つロール)が必要ですが、これは
REM      共有されていません。
REM そのため、実行はお客様側の、AWS CLIがインストール済みでS3への書き込み権限を
REM 持つWindows PC(Role Bの方の端末など)で行っていただく想定です。
REM
REM 事前準備:
REM   1. AWS CLI (https://aws.amazon.com/jp/cli/) をインストールする。
REM   2. コマンドプロンプトで「aws configure」を実行し、デプロイ用のアクセスキー/
REM      シークレットキーを設定する(このバケットへの s3:PutObject /
REM      s3:DeleteObject / s3:ListBucket 権限が必要)。
REM ===================================================================

set BUCKET=cisco-sin-frontend-966042698775-ap-southeast-1-an
set REGION=ap-southeast-1

where aws >nul 2>nul
if errorlevel 1 (
	echo エラー: AWS CLIが見つかりません。先に https://aws.amazon.com/jp/cli/ からインストールしてください。
	pause
	exit /b 1
)

echo == 1/3: 依存パッケージのインストール ==
cd /d "%~dp0client"
call npm ci
if errorlevel 1 goto :error

echo == 2/3: プロダクションビルド (client\.env の VITE_ 変数がバンドルに埋め込まれます) ==
call npm run build
if errorlevel 1 goto :error

echo == 3/3: S3バケットへ同期 (s3://%BUCKET%) ==
call aws s3 sync dist "s3://%BUCKET%" --region %REGION% --delete
if errorlevel 1 goto :error

echo.
echo 完了しました。
echo ※ CloudFrontを併用している場合は、キャッシュ更新のため以下のような
echo   invalidation(キャッシュ無効化)の実行も忘れずに行ってください:
echo     aws cloudfront create-invalidation --distribution-id ^<DISTRIBUTION_ID^> --paths "/*"
echo   (DISTRIBUTION_IDは今回共有されていないため、Role Bにご確認ください)
pause
exit /b 0

:error
echo.
echo エラーが発生したため中断しました。上のメッセージをご確認ください。
pause
exit /b 1
