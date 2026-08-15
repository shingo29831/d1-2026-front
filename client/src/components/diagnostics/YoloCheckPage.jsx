import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { SKELETON_CONNECTIONS, MAX_PERSONS, CONF_THRESHOLD } from '../../config';
import { useTheme } from '../../themeContext';

// 「YOLOの起動・動作確認」ページ。
// 以前のApp.jsxの中身(Webカメラ/動画入力・2D骨格オーバーレイ・3Dミニプレビュー)を
// ほぼそのまま移設したもの。検出パイプライン自体はApp.jsxで一元管理されているため、
// ここではpropsで受け取ったデータを表示するだけの役割になっている。
//
// 【Webカメラ映像(<video>要素)について】
// このページを離れても検出処理(フレームキャプチャ→サーバー送信)が止まらない
// ようにするため、実際の<video>要素はApp.jsx側で常時マウントしたまま
// createPortalでこのページの中に「差し込む」形にしている(このページが
// 表示されていない間は画面外に隠される)。そのため、このコンポーネント自身は
// <video>を直接描画せず、差し込み先となる空のプレースホルダー要素
// (videoSlotRef)を用意し、マウント時にApp.jsxへ場所を教える
// (registerVideoSlot)だけの役割になっている。
function updateCylinderBetweenPoints(mesh, p1, p2, radius) {
  const distance = p1.distanceTo(p2);
  if (distance < 1.0) {
    mesh.visible = false;
    return;
  }
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.scale.set(radius, distance, radius);
  mesh.lookAt(p2);
  mesh.rotateX(Math.PI / 2);
  mesh.visible = true;
}

export default function YoloCheckPage({
  registerVideoSlot,
  fileInputRef,
  inputMode,
  handleFileChange,
  connected,
  poseData,
  lastPoseAt,
  shouldCapture,
  cameraError,
  requestWebcam,
}) {
  const canvas2dRef = useRef(null);
  const canvas3dRef = useRef(null);
  const poseDataRef = useRef(null);
  const videoSlotRef = useRef(null);
  const [showRaw, setShowRaw] = useState(false);
  const { theme } = useTheme();

  // マウント中だけ、このページ内のプレースホルダー要素をWebカメラ映像の
  // 表示先としてApp.jsxへ登録する。アンマウント時(=ページを離れたとき)は
  // 必ずnullに戻し、App.jsx側で映像を画面外へ隠すようにする。
  useEffect(() => {
    if (registerVideoSlot) registerVideoSlot(videoSlotRef.current);
    return () => { if (registerVideoSlot) registerVideoSlot(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pose-dataが更新されるたびに2Dオーバーレイを再描画
  useEffect(() => {
    poseDataRef.current = poseData;
    if (!canvas2dRef.current || !poseData || !Array.isArray(poseData.keypoints)) return;

    const ctx = canvas2dRef.current.getContext('2d');
    ctx.clearRect(0, 0, 640, 480);

    poseData.keypoints.forEach((keypoints) => {
      if (!Array.isArray(keypoints)) return;

      keypoints.forEach((kpt) => {
        if (!Array.isArray(kpt) || kpt.length < 3) return;
        const [x, y, conf] = kpt;
        if (conf > CONF_THRESHOLD) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#00ffcc';
          ctx.fill();
        }
      });

      ctx.strokeStyle = '#00ffcc';
      ctx.lineWidth = 2;
      SKELETON_CONNECTIONS.forEach(([i, j]) => {
        const kpt1 = keypoints[i];
        const kpt2 = keypoints[j];
        if (Array.isArray(kpt1) && Array.isArray(kpt2) && kpt1[2] > CONF_THRESHOLD && kpt2[2] > CONF_THRESHOLD) {
          ctx.beginPath();
          ctx.moveTo(kpt1[0], kpt1[1]);
          ctx.lineTo(kpt2[0], kpt2[1]);
          ctx.stroke();
        }
      });
    });
  }, [poseData]);

  // 3Dミニプレビュー(単独パネル、正面向き)のセットアップ
  useEffect(() => {
    if (!canvas3dRef.current) return;

    const width = 480;
    const height = 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.mode === 'dark' ? 0x090a0f : 0xdce7f2);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    camera.position.set(0, 0, 900);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    canvas3dRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const mainLight = new THREE.DirectionalLight(0x00ffcc, 1.2);
    mainLight.position.set(200, 400, 300);
    scene.add(mainLight);
    const backLight = new THREE.DirectionalLight(0x3366ff, 0.8);
    backLight.position.set(-200, -200, -200);
    scene.add(backLight);

    const gridHelper = new THREE.GridHelper(1000, 20, 0x1f293d, 0x151922);
    gridHelper.position.y = -300;
    scene.add(gridHelper);

    const jointMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.2, metalness: 0.4 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.3, metalness: 0.2 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, transparent: true, opacity: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });

    const persons = [];
    const sphereGeo = new THREE.SphereGeometry(6, 16, 16);
    const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12);

    for (let p = 0; p < MAX_PERSONS; p++) {
      const personGroup = new THREE.Group();
      scene.add(personGroup);

      const spheres = [];
      for (let i = 0; i < 17; i++) {
        const sphere = new THREE.Mesh(sphereGeo, jointMat);
        sphere.visible = false;
        personGroup.add(sphere);
        spheres.push(sphere);
      }

      const limbCylinders = SKELETON_CONNECTIONS.map(() => {
        const cylinder = new THREE.Mesh(cylinderGeo, limbMat);
        cylinder.visible = false;
        personGroup.add(cylinder);
        return cylinder;
      });

      const headMesh = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 16), headMat);
      headMesh.scale.set(0.9, 1.2, 1.0);
      headMesh.visible = false;
      personGroup.add(headMesh);

      const torsoMesh = new THREE.Mesh(cylinderGeo, bodyMat);
      torsoMesh.visible = false;
      personGroup.add(torsoMesh);

      persons.push({ group: personGroup, spheres, limbCylinders, headMesh, torsoMesh });
    }

    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();

      const currentData = poseDataRef.current;
      persons.forEach((p) => { p.group.visible = false; });

      if (currentData && currentData.keypoints && Array.isArray(currentData.keypoints)) {
        currentData.keypoints.forEach((keypoints, personIndex) => {
          if (personIndex >= MAX_PERSONS || !Array.isArray(keypoints)) return;

          const person = persons[personIndex];
          person.group.visible = true;
          const coords = [];

          keypoints.forEach((kpt, i) => {
            const sphere = person.spheres[i];
            if (!sphere) return;
            if (!Array.isArray(kpt) || kpt.length < 3) {
              sphere.visible = false;
              coords[i] = null;
              return;
            }
            const x = kpt[0] - 320;
            const y = -(kpt[1] - 240);
            const z = 0;
            if (kpt[2] > CONF_THRESHOLD) {
              sphere.position.set(x, y, z);
              sphere.visible = true;
              coords[i] = new THREE.Vector3(x, y, z);
            } else {
              sphere.visible = false;
              coords[i] = null;
            }
          });

          // --- 腕が体の前にあるかどうかの簡易判定(手が胴体にめり込んで見える問題の対策) ---
          // YOLOv8-Poseは単眼2Dの検出のため、本来は深さ(z)の情報を持っていない
          // (このファイルではこれまで全キーポイントをz=0に配置していた)。その
          // ため、実際の映像で腕が体の前を横切っている場合でも、3D側では腕と
          // 胴体の円柱が同じz=0上でぶつかり合い、Z-fighting(手が胴体にめり込ん
          // で見える)が起きていた。
          // ここでは「手首(手)の2D位置が胴体の矩形範囲内に入っているか」を
          // 簡易的な目安にして、入っていれば「腕が体の前にある」とみなし、
          // その腕(肘・手首)だけをカメラ側(+z)へ押し出して描画する。これにより
          // 正確な深さ推定ではないが、少なくとも腕が体の後ろに隠れず、めり込ま
          // ずに見えるようになる。
          const FRONT_Z = 40; // 手首をどれだけ手前に出すか
          const ELBOW_Z = FRONT_Z * 0.45; // 肘は手首ほど前に出さない(自然な腕の傾き)
          if (coords[5] && coords[6] && coords[11] && coords[12]) {
            const torsoPad = 14; // 胴体の円柱の太さ相当の余白
            const txMin = Math.min(coords[5].x, coords[6].x, coords[11].x, coords[12].x) - torsoPad;
            const txMax = Math.max(coords[5].x, coords[6].x, coords[11].x, coords[12].x) + torsoPad;
            const tyMin = Math.min(coords[5].y, coords[6].y, coords[11].y, coords[12].y) - torsoPad;
            const tyMax = Math.max(coords[5].y, coords[6].y, coords[11].y, coords[12].y) + torsoPad;

            // { 手首, 肘 } のペア(左右それぞれ)
            [[9, 7], [10, 8]].forEach(([wristIdx, elbowIdx]) => {
              const wrist = coords[wristIdx];
              if (!wrist) return;
              const inFrontOfTorso = wrist.x >= txMin && wrist.x <= txMax && wrist.y >= tyMin && wrist.y <= tyMax;
              if (!inFrontOfTorso) return;

              wrist.z = FRONT_Z;
              if (person.spheres[wristIdx]) person.spheres[wristIdx].position.z = FRONT_Z;

              const elbow = coords[elbowIdx];
              if (elbow) {
                elbow.z = ELBOW_Z;
                if (person.spheres[elbowIdx]) person.spheres[elbowIdx].position.z = ELBOW_Z;
              }
            });
          }

          if (coords[0]) {
            person.headMesh.position.copy(coords[0]);
            person.headMesh.visible = true;
          } else {
            person.headMesh.visible = false;
          }

          if (coords[5] && coords[6] && coords[11] && coords[12]) {
            const midShoulder = new THREE.Vector3().addVectors(coords[5], coords[6]).multiplyScalar(0.5);
            const midHip = new THREE.Vector3().addVectors(coords[11], coords[12]).multiplyScalar(0.5);
            updateCylinderBetweenPoints(person.torsoMesh, midShoulder, midHip, 14);
          } else {
            person.torsoMesh.visible = false;
          }

          SKELETON_CONNECTIONS.forEach(([i, j], index) => {
            const p1 = coords[i];
            const p2 = coords[j];
            const cylinder = person.limbCylinders[index];
            if (p1 && p2) {
              let radius = 6;
              if ((i === 5 && j === 6) || (i === 11 && j === 12)) radius = 8;
              else if ((i === 11 && j === 13) || (i === 12 && j === 14)) radius = 7;
              updateCylinderBetweenPoints(cylinder, p1, p2, radius);
            } else {
              cylinder.visible = false;
            }
          });
        });
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      if (canvas3dRef.current) canvas3dRef.current.innerHTML = '';
    };
    // theme.modeが変わったら背景色を反映するため3Dシーンを作り直す
  }, [theme.mode]);

  const personCount = poseData && Array.isArray(poseData.keypoints) ? poseData.keypoints.length : 0;
  const lastSeenSec = lastPoseAt ? ((Date.now() - lastPoseAt) / 1000).toFixed(1) : '-';

  return (
    <div style={{ padding: '24px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0, color: theme.textStrong }}>YOLOv8 + Node.js + Three.js 動作確認</h2>

      {shouldCapture === false && (
        <div style={{
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.4)',
          color: '#fbbf24',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12.5,
          maxWidth: 720,
          lineHeight: 1.6,
          marginBottom: 16,
        }}>
          この端末は「閲覧専用モード」です。他の見守り対象デバイスが送っている検出結果は表示されますが、
          この端末自身のカメラでの検出は行われません。この端末のカメラで検出を行いたい場合は、
          アドレスバーのURL末尾に <code>?capture=1</code> を付けて開き直してください。
        </div>
      )}

      {cameraError && (
        <div style={{
          background: 'rgba(248,113,113,0.1)',
          border: '1px solid rgba(248,113,113,0.4)',
          color: '#fca5a5',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12.5,
          maxWidth: 720,
          lineHeight: 1.6,
          marginBottom: 16,
        }}>
          ⚠ カメラを起動できませんでした: {cameraError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0 20px', fontSize: 13, color: theme.textMuted }}>
        <StatusChip label="サーバー接続" ok={connected} theme={theme} />
        <StatusChip label="人物検出中" ok={personCount > 0} theme={theme} />
        <span>検出人数: {personCount}</span>
        <span>最終受信からの経過: {lastSeenSec}s</span>
      </div>

      <div style={{ margin: '20px 0', display: 'flex', justifyContent: 'center', gap: '15px', alignItems: 'center' }}>
        <button
          onClick={requestWebcam}
          style={{ padding: '10px 20px', background: inputMode === 'webcam' && !cameraError ? '#00ffcc' : '#333', color: inputMode === 'webcam' && !cameraError ? '#000' : '#fff', border: cameraError ? '1px solid #f87171' : 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Webカメラを使用{cameraError ? '(再試行)' : ''}
        </button>
        <button
          onClick={() => fileInputRef.current.click()}
          style={{ padding: '10px 20px', background: inputMode === 'video' ? '#00ffcc' : '#333', color: inputMode === 'video' ? '#000' : '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          動画ファイルをアップロード
        </button>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" style={{ display: 'none' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontWeight: 'bold' }}>入力映像 (Webcam / Video)</p>
          {/* 実際の<video>要素はApp.jsx側からcreatePortalで差し込まれる
              (このページ滞在中だけ表示位置がここになる)。 */}
          <div ref={videoSlotRef} style={{ width: '480px', height: '360px', background: '#000', borderRadius: '8px' }} />
        </div>

        <div>
          <p style={{ fontWeight: 'bold' }}>2D 骨格オーバーレイ</p>
          <div style={{ position: 'relative', width: '480px', height: '360px', margin: '0 auto' }}>
            <canvas
              ref={canvas2dRef}
              width="640"
              height="480"
              style={{ width: '480px', height: '360px', background: '#000', borderRadius: '8px', position: 'absolute', top: 0, left: 0 }}
            />
          </div>
        </div>

        <div>
          <p style={{ fontWeight: 'bold' }}>3D ヒューマノイドアバター（複数人対応）</p>
          <div ref={canvas3dRef} style={{ width: '480px', height: '480px', background: '#000', borderRadius: '8px', overflow: 'hidden', margin: '0 auto' }} />
        </div>
      </div>

      <div style={{ marginTop: 24, maxWidth: 900, marginInline: 'auto' }}>
        <button
          onClick={() => setShowRaw((v) => !v)}
          style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 13 }}
        >
          {showRaw ? '▼' : '▶'} デバッグ: pose-data 生データ
        </button>
        {showRaw && (
          <pre style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12, maxHeight: 260, overflow: 'auto', fontSize: 11, color: theme.textMuted }}>
            {JSON.stringify(poseData, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function StatusChip({ label, ok, theme }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? theme.accent : theme.textFaint }} />
      {label}
    </span>
  );
}
