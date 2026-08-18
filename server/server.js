const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8
});

const python = spawn('python', ['pose_estimation.py'], { shell: true });

// --- YOLO推論のバックプレッシャー制御 ---
let busy = false;
let latestFrame = null;

function maybeSendNext() {
  if (busy || !latestFrame) return;
  if (!python.stdin.writable) return;
  const frame = latestFrame;
  latestFrame = null;
  busy = true;
  try {
    python.stdin.write(frame + '\n');
  } catch (err) {
    console.error('Frame write error:', err);
    busy = false;
  }
}

let stdoutBuffer = '';
python.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop(); // 最後の要素は未完成の可能性があるため次回に持ち越す

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const json = JSON.parse(trimmed);
      // Web上のコンソール出力と合わせるため、サーバー側でも本番形式のログを出力
      console.log(`[Local Server] メッセージ送信 [child_monitoring/${json.event_type}]:`, JSON.stringify(json));
      io.emit('pose-data', json);
    } catch (e) {
      // 解析できない行は無視(ログ行など)
    }
  }

  // 1フレーム分の処理が完了したとみなし、次のフレーム(あれば)を送る
  busy = false;
  maybeSendNext();
});

python.stderr.on('data', (data) => {
  console.error(`Python Error: ${data}`);
});

python.on('close', (code) => {
  console.log(`Python process exited with code ${code}`);
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('video-frame', (dataURL) => {
    // busy中に届いたフレームは古いものとして上書きし、最新の1枚だけを残す
    latestFrame = dataURL;
    maybeSendNext();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Node.js Server running on port ${PORT}`);
});