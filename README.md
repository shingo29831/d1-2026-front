# 見守りシステム (d1-2026-front)

Webカメラの映像からYOLOv8を用いて人物の骨格検出を行い、3D空間上にマッピングして見守りを行うシステムです。

## プロジェクト構成
- **フロントエンド**: React + Vite + Three.js (@react-three/fiber)
- **バックエンド (`server/`)**: Node.js (Socket.io) + Python (YOLOv8-Pose)
- **インフラ**: Docker Compose, AWS (Cognito, IoT Core)

## 必須要件
- Node.js (v18以上推奨)
- Python 3.9以上 (ローカルでバックエンドを起動する場合)
- Docker & Docker Compose (コンテナで起動する場合)

## 起動方法

### パターン1: Docker Compose を使用する場合（推奨）
```bash
docker compose up -d --build
```
起動後、ブラウザで `http://localhost` にアクセスします。

### パターン2: ローカルで個別に起動する場合

#### 1. バックエンドの起動
```bash
cd server
npm install
pip install -r requirements.txt
node server.js
```

#### 2. フロントエンドの起動
別のターミナルを開き、プロジェクトルートで実行します。
```bash
npm install
npm run dev
```
ブラウザで `http://localhost` にアクセスします。

## 環境変数の設定
`.env.example` をコピーして `.env` を作成し、必要なAWS CognitoやIoT Coreの設定を記述してください。
```bash
cp .env.example .env
```

## 利用方法
1. ログイン画面からAWS Cognito経由でログインします。
2. 「カメラ位置の設定」タブで、実際のカメラの設置位置と3D空間の視点を合わせます。
3. 「見守りダッシュボード」を開くと、カメラ映像から骨格検出が開始され、3D空間上に人物がマッピングされます。

## 本番環境へのデプロイ
フロントエンドをAWS S3へ静的ホスティングとしてデプロイする手順については、[DEPLOY.md](./DEPLOY.md) を参照してください。
デプロイ用のスクリプトとして `deploy-s3.sh` (Mac/Linux) および `deploy-s3.bat` (Windows) が用意されています。