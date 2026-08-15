import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';

// ===================================================================
// YOLOの検出パイプライン（Webカメラ/動画 → フレーム送信 → pose-data受信）を
// アプリ全体で1つだけ動かすためのフック。
//
// 【Role C仕様書との対応】pose-data受信部分が仕様書Step 3「MQTT over
// WebSocketの受信」・Step 4「リアルタイムアラートの3Dマッピング」の入力元に
// 相当する(socket.jsの解説・ROLE_C_SPEC_ALIGNMENT.mdも参照)。将来的に
// IoT Core経由のMQTT受信へ置き換える際は、下記の`socket.on('pose-data', ...)`
// をMQTTトピックのメッセージハンドラに差し替える想定。
//
// 以前はApp.jsx内に直接書かれていたロジックをそのまま抽出したもの。
// どの画面(見守りダッシュボード/YOLO動作確認/Polycam動作確認)を見ていても
// 検出処理が止まらないよう、App.jsxのトップレベルで一度だけ呼び出す。
//
// 【インターネット公開時の注意】
// このアプリをインターネットに公開すると、ダッシュボードを開いた端末すべてが
// 「自分のWebカメラで検出を開始しよう」としてしまい、見守り対象の部屋とは
// 無関係な映像が混ざったり、サーバー側のPython処理が競合したりしてしまいます。
// そのため、実際にカメラでその部屋を映す端末だけURLに `?capture=1` を付けて
// アクセスしてください。それ以外の端末(外出先から様子を見るだけの端末)は
// 自動的に「閲覧専用モード」になり、カメラへのアクセスも要求されません。
// (このPC自身で `http://localhost:5173` を開く場合は今まで通り自動で有効になります)
function resolveShouldCapture() {
  if (typeof window === 'undefined') return true;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('capture')) {
      return !['0', 'false', 'off'].includes(params.get('capture'));
    }
    if (params.has('view')) return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return true;
  }
}

// getUserMediaが投げるエラーは英語のエラー名(err.name)しか付いてこないことが多いので、
// 「映らない」ときにブラウザのDevToolsを開かなくても原因が分かるよう、日本語の説明文に変換する。
function describeCameraError(err) {
  const name = err && err.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'カメラへのアクセスが許可されていません。アドレスバー付近のカメラアイコン(鍵マークの近く)からサイトの設定を開き、カメラを「許可」に変更してからもう一度お試しください。Windowsの「設定 > プライバシーとセキュリティ > カメラ」でブラウザのアクセスが許可されているかもご確認ください。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '使用できるカメラが見つかりませんでした。PCにカメラが接続されているかご確認ください。';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'カメラを起動できませんでした。他のアプリ(Zoom、Teams、別のブラウザタブなど)がカメラを使用中の可能性があります。それらを閉じてからもう一度お試しください。';
    case 'OverconstrainedError':
      return '指定した設定でカメラを起動できませんでした。';
    case 'SecurityError':
      return 'セキュリティ上の理由でカメラにアクセスできませんでした。"http://localhost" のURLでアクセスしているかご確認ください。';
    default:
      return `カメラの起動に失敗しました${err && err.message ? `(${err.message})` : ''}。`;
  }
}

export function useDetectionPipeline() {
  const [shouldCapture] = useState(resolveShouldCapture);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const [inputMode, setInputMode] = useState('webcam'); // 'webcam' | 'video'
  const [videoSrc, setVideoSrc] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const [connected, setConnected] = useState(socket.connected);
  const [poseData, setPoseData] = useState(null);
  const [lastPoseAt, setLastPoseAt] = useState(null);

  // Webカメラを(再)起動する。
  // 「Webカメラを使用」ボタンはこの関数を直接呼び出すようにしており、既にwebcamモードで
  // あっても押すたびに必ずgetUserMediaをやり直す(＝再試行できる)ようにしている。
  // 以前はsetInputMode('webcam')だけを呼んでいたため、初回のカメラ起動に失敗すると
  // (許可を拒否した、他のアプリがカメラを使用中だった、など)inputModeがすでに'webcam'の
  // ままなのでボタンを何度押しても再試行されず、映像が永久に真っ黒になる問題があった。
  const requestWebcam = useCallback(async () => {
    if (!shouldCapture) return;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      if (videoRef.current) {
        if (videoRef.current.srcObject) {
          videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        }
        videoRef.current.removeAttribute('src');
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      } else {
        // video要素がまだ描画されていないタイミングでも、ストリーム自体は破棄する。
        stream.getTracks().forEach((t) => t.stop());
      }
      setInputMode('webcam');
    } catch (err) {
      console.error('Webcam error:', err);
      setCameraError(describeCameraError(err));
    }
  }, [shouldCapture]);

  // 初回マウント時に自動でWebカメラを起動する(閲覧専用モードでは何もしない)
  useEffect(() => {
    if (!shouldCapture) return undefined;
    requestWebcam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCapture]);

  // 動画ファイルへの切り替え(閲覧専用モードでは何もしない)
  useEffect(() => {
    if (!shouldCapture) return undefined;
    if (inputMode === 'video' && videoSrc && videoRef.current) {
      if (videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      videoRef.current.src = videoSrc;
      videoRef.current.loop = true;
      videoRef.current.play();
    }
  }, [inputMode, videoSrc, shouldCapture]);

  // socket.io: 接続状態 & pose-data受信
  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handlePoseData = (data) => {
      setPoseData(data);
      setLastPoseAt(Date.now());
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('pose-data', handlePoseData);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('pose-data', handlePoseData);
    };
  }, []);

  // 100msごとに映像フレームをキャプチャしてサーバーへ送信(閲覧専用モードでは送信しない)
  useEffect(() => {
    if (!shouldCapture) return undefined;
    const captureInterval = setInterval(() => {
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 640, 480);
        const dataURL = canvas.toDataURL('image/jpeg', 0.6);
        socket.emit('video-frame', dataURL);
      }
    }, 100);

    return () => clearInterval(captureInterval);
  }, [shouldCapture]);

  // クリーンアップ: アンマウント時にWebカメラを止める
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
      setCameraError(null);
      setInputMode('video');
    }
  };

  return {
    videoRef,
    fileInputRef,
    inputMode,
    setInputMode,
    videoSrc,
    handleFileChange,
    connected,
    poseData,
    lastPoseAt,
    shouldCapture,
    cameraError,
    requestWebcam,
  };
}
