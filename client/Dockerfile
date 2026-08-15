# 子供見守りシステム - クライアント用イメージ
# 1段階目: React+Three.jsアプリをビルド(npm install / vite buildを自動実行)
# 2段階目: ビルド成果物をCaddyで配信 + /socket.io/ をサーバーへ中継(HTTPS自動対応)

# --- build stage ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# 見守りサーバーへの接続先。空にするとCaddy経由の同一オリジン接続になる(推奨・デフォルト)。
ARG VITE_SOCKET_URL=
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

# AWS Cognito / IoT Core / 履歴API(Role C仕様書 Step 1/3/5)。
# docker-compose.yml の build.args 経由でルートの .env から渡される。
# パスワード等の秘密情報はビルド引数として渡さない(渡す必要が無い)。
ARG VITE_AWS_REGION=
ARG VITE_COGNITO_USER_POOL_ID=
ARG VITE_COGNITO_CLIENT_ID=
ARG VITE_COGNITO_IDENTITY_POOL_ID=
ARG VITE_IOT_ENDPOINT=
ARG VITE_HISTORY_API_URL=
ENV VITE_AWS_REGION=$VITE_AWS_REGION \
    VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID \
    VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID \
    VITE_COGNITO_IDENTITY_POOL_ID=$VITE_COGNITO_IDENTITY_POOL_ID \
    VITE_IOT_ENDPOINT=$VITE_IOT_ENDPOINT \
    VITE_HISTORY_API_URL=$VITE_HISTORY_API_URL

RUN npm run build

# --- serve stage ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
