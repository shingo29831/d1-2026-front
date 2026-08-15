import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Grid, Center } from '@react-three/drei';
import * as THREE from 'three';
import GltfErrorBoundary from '../room-scene/GltfErrorBoundary';
import { ROOM_MODEL_PATH } from '../../config';
import { useTheme } from '../../themeContext';

function LoadedModel({ url, onStats }) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    let meshCount = 0;
    let triCount = 0;
    scene.traverse((obj) => {
      if (obj.isMesh) {
        meshCount += 1;
        const geo = obj.geometry;
        if (geo && geo.index) triCount += geo.index.count / 3;
        else if (geo && geo.attributes && geo.attributes.position) triCount += geo.attributes.position.count / 3;
      }
    });
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    onStats({
      status: 'ok',
      meshCount,
      triCount: Math.round(triCount),
      size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  return <primitive object={scene} />;
}

function LoadFailNotice({ onStats, message }) {
  useEffect(() => {
    onStats({ status: 'error', message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <mesh>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color={'#f43f5e'} wireframe />
    </mesh>
  );
}

export default function PolycamCheckPage() {
  const [localUrl, setLocalUrl] = useState(null);
  const [localFileName, setLocalFileName] = useState(null);
  const [localStats, setLocalStats] = useState(null);

  const [publicStats, setPublicStats] = useState(null);
  const [tryPublicPath, setTryPublicPath] = useState(false);

  // ③ 間取り図(上から見た図)の画像プレビュー用。Polycamは3DスキャンだけでなくPDF/画像形式の
  // 間取り図も出力できるため、GLTF/GLBだけでなく画像もこの場で読み込んで確認できるようにする。
  const [floorPlanUrl, setFloorPlanUrl] = useState(null);
  const [floorPlanName, setFloorPlanName] = useState(null);
  const [floorPlanSize, setFloorPlanSize] = useState(null);
  const [floorPlanZoom, setFloorPlanZoom] = useState(1);

  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalFileName(file.name);
    setLocalStats(null);
    setLocalUrl(URL.createObjectURL(file));
  };

  const onFloorPlanChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (floorPlanUrl) URL.revokeObjectURL(floorPlanUrl);
    setFloorPlanName(file.name);
    setFloorPlanSize(null);
    setFloorPlanZoom(1);
    setFloorPlanUrl(URL.createObjectURL(file));
  };

  const onFloorPlanImgLoad = (e) => {
    setFloorPlanSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  };

  const clearFloorPlan = () => {
    if (floorPlanUrl) URL.revokeObjectURL(floorPlanUrl);
    setFloorPlanUrl(null);
    setFloorPlanName(null);
    setFloorPlanSize(null);
    setFloorPlanZoom(1);
  };

  return (
    <div style={{ padding: '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0, color: theme.textStrong, fontSize: 22 }}>Polycamの動作確認</h2>
      <p style={{ color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5 }}>
        Polycamでスキャンした自室のGLTF/GLBを読み込めるか確認するページです。
        まずはこの場でファイルを選択して見た目を確認し、問題なければ
        <code style={{ margin: '0 4px' }}>client/public/models/</code>
        に配置してください（本番の見守りダッシュボードは
        <code style={{ margin: '0 4px' }}>{ROOM_MODEL_PATH}</code>
        を読み込みます）。
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 20 }}>
        {/* ローカルファイルでのその場プレビュー */}
        <section style={styles.card}>
          <h3 style={styles.cardTitle}>① ローカルファイルでプレビュー</h3>
          <p style={styles.cardDesc}>
            .glb（単一バイナリファイル）を選択してください。.gltf + .bin + テクスチャ一式の場合は
            相対パス参照の都合上このプレビューでは正しく表示できないことがあるため、
            その場合は下の②の手順でpublicフォルダに配置してから確認してください。
          </p>
          <input type="file" accept=".glb,.gltf" onChange={onFileChange} style={{ color: theme.textMuted, fontSize: 12 }} />

          <div style={styles.viewer}>
            {localUrl ? (
              <Canvas camera={{ position: [2.2, 1.8, 2.2], fov: 45 }} shadows>
                <color attach="background" args={[theme.sceneBg]} />
                <ambientLight intensity={theme.sceneAmbient} />
                <directionalLight position={[3, 4, 2]} intensity={1} castShadow />
                <Grid args={[10, 10]} cellColor={theme.sceneGrid1} sectionColor={theme.sceneGrid2} position={[0, 0, 0]} />
                <GltfErrorBoundary
                  resetKey={localUrl}
                  fallback={<LoadFailNotice onStats={setLocalStats} message="読み込みに失敗しました(形式/破損の可能性)" />}
                >
                  <Suspense fallback={null}>
                    <Center>
                      <LoadedModel url={localUrl} onStats={setLocalStats} />
                    </Center>
                  </Suspense>
                </GltfErrorBoundary>
                <OrbitControls enableDamping />
              </Canvas>
            ) : (
              <div style={styles.emptyViewer}>ファイル未選択</div>
            )}
          </div>

          {localFileName && <div style={styles.statLine}>ファイル名: {localFileName}</div>}
          {localStats && localStats.status === 'ok' && (
            <div style={styles.statLine}>
              メッシュ数: {localStats.meshCount} / 三角形数: {localStats.triCount.toLocaleString()} /
              サイズ(m): {localStats.size.x} × {localStats.size.y} × {localStats.size.z}
            </div>
          )}
          {localStats && localStats.status === 'error' && (
            <div style={{ ...styles.statLine, color: theme.danger }}>{localStats.message}</div>
          )}
        </section>

        {/* public/models配下の本番パス確認 */}
        <section style={styles.card}>
          <h3 style={styles.cardTitle}>② 配置後の本番パスを確認</h3>
          <p style={styles.cardDesc}>
            <code>client/public/models/</code> にファイルを配置したら、下のボタンで
            見守りダッシュボードと同じパス（<code>{ROOM_MODEL_PATH}</code>）から読み込めるか確認できます。
          </p>
          <button style={styles.tryBtn} onClick={() => setTryPublicPath(true)}>
            {ROOM_MODEL_PATH} を読み込んでみる
          </button>

          <div style={styles.viewer}>
            {tryPublicPath ? (
              <Canvas camera={{ position: [2.2, 1.8, 2.2], fov: 45 }} shadows>
                <color attach="background" args={[theme.sceneBg]} />
                <ambientLight intensity={theme.sceneAmbient} />
                <directionalLight position={[3, 4, 2]} intensity={1} castShadow />
                <Grid args={[10, 10]} cellColor={theme.sceneGrid1} sectionColor={theme.sceneGrid2} position={[0, 0, 0]} />
                <GltfErrorBoundary
                  resetKey={ROOM_MODEL_PATH}
                  fallback={<LoadFailNotice onStats={setPublicStats} message={`${ROOM_MODEL_PATH} が見つかりません。client/public/models/ に配置されているか確認してください。`} />}
                >
                  <Suspense fallback={null}>
                    <Center>
                      <LoadedModel url={ROOM_MODEL_PATH} onStats={setPublicStats} />
                    </Center>
                  </Suspense>
                </GltfErrorBoundary>
                <OrbitControls enableDamping />
              </Canvas>
            ) : (
              <div style={styles.emptyViewer}>未確認</div>
            )}
          </div>

          {publicStats && publicStats.status === 'ok' && (
            <div style={styles.statLine}>
              読み込み成功 / メッシュ数: {publicStats.meshCount} / サイズ(m): {publicStats.size.x} × {publicStats.size.y} × {publicStats.size.z}
            </div>
          )}
          {publicStats && publicStats.status === 'error' && (
            <div style={{ ...styles.statLine, color: theme.danger }}>{publicStats.message}</div>
          )}
        </section>

        {/* ③ 間取り図画像(上から見た図)の確認 */}
        <section style={{ ...styles.card, width: 620 }}>
          <h3 style={styles.cardTitle}>③ 間取り図(上から見た図)を読み込んで確認</h3>
          <p style={styles.cardDesc}>
            Polycamや不動産会社から受け取った間取り図の画像(JPG/PNG)を読み込んで、この場で拡大表示できます。
            部屋の形を作成するときの目安として使えます。「部屋の設定」タブの「自由な多角形」では、
            この画像を下絵として表示しながら、実際の壁の頂点をなぞってクリックしていくことで、
            画像通りの形の部屋を作成できます。
          </p>
          <input type="file" accept="image/*" onChange={onFloorPlanChange} style={{ color: theme.textMuted, fontSize: 12 }} />

          <div style={styles.floorPlanViewer}>
            {floorPlanUrl ? (
              <div style={styles.floorPlanScroll}>
                <img
                  src={floorPlanUrl}
                  alt="間取り図"
                  onLoad={onFloorPlanImgLoad}
                  style={{ width: `${floorPlanZoom * 100}%`, height: 'auto', display: 'block' }}
                />
              </div>
            ) : (
              <div style={styles.emptyViewer}>画像未選択</div>
            )}
          </div>

          {floorPlanUrl && (
            <div style={styles.fovRow}>
              <span style={styles.statLine}>拡大率</span>
              <input
                type="range" min={0.3} max={3} step={0.1} value={floorPlanZoom}
                onChange={(e) => setFloorPlanZoom(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={styles.statLine}>{Math.round(floorPlanZoom * 100)}%</span>
            </div>
          )}

          {floorPlanName && (
            <div style={styles.statLine}>
              ファイル名: {floorPlanName}
              {floorPlanSize && ` / 画像サイズ: ${floorPlanSize.w} × ${floorPlanSize.h}px`}
              <button style={styles.tryBtn} onClick={clearFloorPlan}>削除</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function makeStyles(theme) {
  return {
    card: {
      width: 500,
      background: theme.panelBg,
      border: `1px solid ${theme.border}`,
      borderRadius: 14,
      padding: 20,
    },
    cardTitle: { margin: '0 0 10px', fontSize: 15.5, color: theme.textStrong },
    cardDesc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 12 },
    viewer: {
      width: '100%',
      height: 360,
      background: theme.panelBgAlt,
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: 12,
    },
    emptyViewer: {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.textFaint,
      fontSize: 12,
    },
    statLine: { marginTop: 10, fontSize: 11.5, color: theme.accent },
    tryBtn: {
      padding: '8px 14px',
      fontSize: 12,
      background: theme.mode === 'dark' ? '#164e63' : theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
      borderRadius: 6,
      cursor: 'pointer',
      marginLeft: 10,
    },
    floorPlanViewer: {
      width: '100%',
      height: 420,
      background: theme.panelBgAlt,
      borderRadius: 8,
      overflow: 'auto',
      marginTop: 12,
      border: `1px solid ${theme.borderSoft}`,
    },
    floorPlanScroll: { minWidth: '100%', minHeight: '100%', display: 'inline-block' },
    fovRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  };
}
