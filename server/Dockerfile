# 子供見守りシステム - サーバー(Node.js + Python/YOLOv8-Pose)用イメージ
# 「docker compose up --build」を実行するだけで、npm install / pip install など
# 環境構築がすべてこのイメージのビルド時に自動で行われます。
FROM node:20-slim

# PythonとNode双方が必要(server.jsがpose_estimation.pyを子プロセスとして起動するため)。
# python-is-python3 で `python` コマンドを使えるようにする(server.js側は変更不要)。
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Pythonの依存関係 ---
# torch/torchvisionはCPU版を明示的に指定してインストールする。
# (指定しないとGPU版の巨大なパッケージが解決されてしまい、イメージが不必要に肥大化するため)
#
# 【注意】ultralyticsは内部で「opencv-python」(GUI版)を依存として要求するため、
# requirements.txtで「opencv-python-headless」を指定していても、放っておくと
# GUI版が混ざって上書きされ、GUI用の共有ライブラリ(libGL.so.1 / libxcb.so.1 など)
# が無いこの軽量イメージでは "ImportError: libxcb.so.1: cannot open shared object file"
# のようなエラーで起動に失敗する。そのため最後にheadless版を強制的に入れ直している。
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages \
      torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
    && pip3 install --no-cache-dir --break-system-packages --force-reinstall --no-deps opencv-python-headless

# --- Node.jsの依存関係 ---
COPY package*.json ./
RUN npm ci --omit=dev

# アプリ本体(pose_estimation.py, server.js, yolov8n-pose.pt など)
COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
