import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';
import { connectIotCore } from '../iotClient';
import { IOT_SUBSCRIBE_TOPIC } from '../config';
import { useOperationMode } from '../operationModeContext';

// ===================================================================
// YOLOの検出パイプライン（Webカメラ/動画 → フレーム送信 → pose-data受信）を
// アプリ全体で1つだけ動かすためのフック。
//
// 【デモ用データ/本番環境の切り替え(operationModeContext.jsx)との対応】
// このフックは、ハンバーガーメニューの「デモ用データ/本番環境」トグルの
// 状態(useOperationMode())に応じて、データの取得経路を丸ごと切り替える。
//   ・デモ(demo): 以前からの実装のまま。この端末のWebカメラ映像を100msごとに
//     キャプチャしてSocket.IO経由でサーバーへ送信し(video-frame)、サーバー側の
//     YOLO推論結果をSocket.IOのpose-dataイベントで受信して即座に3D表示する。
//   ・本番(production): 仕様書(Role A / Role C)通り、カメラ映像の取得と
//     AI推論はエッジ(EC2)側の役割のため、Webカメラの起動・フレーム送信は
//     一切行わない。Socket.IOへの接続も行わず(socket.disconnect())、
//     AWS IoT CoreからMQTT over WebSocketで受信した離散イベント(iotMessage)
//     のみを扱う「閲覧専用」になる。仕様書のJSONスキーマ(ai_hazard/
//     sensor_alert/complex_alert/risk_suggestion)には継続的な姿勢(pose)
//     ストリームは存在しないため、本番ではposeData(連続的な人物追跡用の
//     状態)は常にnullのままになる(=デモ用データの「歩き続ける3Dアバター」は
//     デモ専用の表現であり、本番では表示されない。本番での危険通知・人物
//     マーカー表示はuseMonitoringAlerts.js側でiotMessageから直接組み立てる)。
//
// 【Role C仕様書との対応】pose-data受信部分が仕様書Step 3「MQTT over
// WebSocketの受信」・Step 4「リアルタイムアラートの3Dマッピング」の入力元に
// 相当する(socket.jsの解説・ROLE_C_SPEC_ALIGNMENT.mdも参照)。
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
  const { isProduction } = useOperationMode();
  const [shouldCaptureByUrl] = useState(resolveShouldCapture);
  // 本番環境モードでは、URLパラメータ(?capture=1)や接続端末に関わらず、必ず
  // 「閲覧専用」(Webカメラ起動・フレーム送信を一切行わない)にする。仕様書
  // (Role A/Role C)通り、カメラ映像の取得・AI推論はエッジ(EC2)側の役割であり、
  // フロントエンドはAWS IoT CoreからのMQTT受信のみを行う画面のため。
  const shouldCapture = isProduction ? false : shouldCaptureByUrl;
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const [inputMode, setInputMode] = useState('webcam'); // 'webcam' | 'video'
  const [videoSrc, setVideoSrc] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [poseData, setPoseData] = useState(null);
  const [lastPoseAt, setLastPoseAt] = useState(null);

  // AWS IoT Core (本番環境) の接続状態と受信メッセージ
  const [iotConnected, setIotConnected] = useState(false);
  const [iotMessage, setIotMessage] = useState(null);

  // 表示・判定に使う実際の「接続中」状態は、モードに応じてSocket.IO/IoT Coreの
  // どちらか一方の接続状態を採用する(以前はSocket.IOの接続状態だけを見ていたため、
  // 本番環境でIoT Coreに接続できていてもヘッダーが「サーバー未接続」のままに
  // なってしまっていた)。
  const connected = isProduction ? iotConnected : socketConnected;

  // 本番環境へ切り替えた瞬間、デモ用データの継続的なpose-data(仕様書のJSON
  // スキーマには存在しない、姿勢の連続ストリーム)は古い値が残ったままに
  // なってしまうため、明示的にクリアしておく(=歩き続ける3Dアバターがデモの
  // 名残として本番環境に居座って表示され続けることを防ぐ)。
  useEffect(() => {
    if (isProduction) {
      setPoseData(null);
      setLastPoseAt(null);
    }
  }, [isProduction]);

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

  // AWS IoT Core (本番環境) への接続とMQTTメッセージ受信。
  // 環境変数 VITE_IOT_ENDPOINT が設定されており、かつ本番環境モードのときだけ
  // 接続する(デモ用データモードでは、たとえ環境変数が設定されていても接続
  // しない。デモ/本番でデータ経路を完全に分離するため)。
  useEffect(() => {
    const endpoint = import.meta.env.VITE_IOT_ENDPOINT;
    if (!endpoint || !isProduction) return undefined;

    let isMounted = true;
    let disconnectFn = null;

    const setupIot = async () => {
      try {
        // iotClient.js の connectIotCore を呼び出し、コールバックでイベントを受け取る
        disconnectFn = await connectIotCore(
          IOT_SUBSCRIBE_TOPIC,
          (topic, message) => {
            if (!isMounted) return;
            console.log('[useDetectionPipeline] IoT Coreからメッセージを受信しました:', topic, message);
            try {
              const data = typeof message === 'string' ? JSON.parse(message) : message;
              // 【重要】ここでposeData(継続的な姿勢ストリーム用のstate)は更新しない。
              // IoT Coreから届くのはai_hazard/sensor_alert/complex_alert/risk_suggestionの
              // いずれかの離散イベントであり、poseDataが期待する
              // { keypoints: [...] }形式の連続的な姿勢データではないため。
              // 通知・危険マーカーの表示は、このiotMessageをuseMonitoringAlerts.js側で
              // 解釈して行う。
              setIotMessage({ topic, data, timestamp: Date.now() });
            } catch (err) {
              console.warn('[IoT] メッセージのパースに失敗しました:', err);
            }
          },
          () => { if (isMounted) setIotConnected(true); },
          () => { if (isMounted) setIotConnected(false); },
          (err) => { console.error('[IoT] 接続エラー:', err); }
        );
      } catch (err) {
        console.error('[IoT] 初期化エラー:', err);
      }
    };

    setupIot();

    return () => {
      isMounted = false;
      if (typeof disconnectFn === 'function') {
        disconnectFn();
      }
      setIotConnected(false);
    };
  }, [isProduction]);

  // socket.io: 接続状態 & pose-data受信(デモ用データモードのみ)。
  // 【本番環境での完全な切り離し】本番環境モードでは、pose-dataイベントの
  // リスナーを登録しないだけでなく、実際のSocket.IO接続そのものも切断する
  // (socket.jsに書かれている通り、この接続はRole C仕様書のMQTT受信を
  // 簡易的にモックしているだけの実装のため、本番では通信自体を発生させない)。
  // デモ用データモードに戻ったときは、本番環境にいる間に切断されている
  // 可能性があるため、明示的に再接続する。
  useEffect(() => {
    if (isProduction) {
      if (socket.connected) socket.disconnect();
      setSocketConnected(false);
      return undefined;
    }

    if (!socket.connected) socket.connect();

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);
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
  }, [isProduction]);

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
    iotConnected,
    iotMessage,
    shouldCapture,
    cameraError,
    requestWebcam,
  };
}
