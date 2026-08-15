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
// 以前はクライアントから届いた video-frame をすべて無条件でPythonへ書き込んで
// いたため、Pythonの推論(1フレームあたり)がクライアントの送信間隔(約100ms)
// より遅い場合、pythonのstdinにフレームがどんどん溜まっていき、見た目の
// 反映が実際の映像からどんどん遅れていく(=「データを反映させるのが少し遅い」)
// 現象が起きていた。
//
// 対策として「今処理中(busy)かどうか」を管理し、処理中に届いたフレームは
// 古いものを破棄して常に最新の1枚(latestFrame)だけを保持する。Pythonが
// 処理を終えて結果を返してきたタイミングで、その時点の最新フレームを
// 次の処理に回す。これにより、常に「今の状況に一番近い」フレームだけが
// 処理され、遅延が際限なく蓄積することがなくなる(=古いフレームは処理せず
// 読み飛ばす)。
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

// Pythonのstdoutは「1回のdataイベント = 1行のJSON」とは限らない(複数行が
// つながって届いたり、1行が複数のdataイベントに分割されて届いたりする)。
// 行単位でバッファリングし、改行で区切られた完全な行だけをJSON.parseする
// ことで、以前あった「結果がまれに無言でロストする」問題を修正している。
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