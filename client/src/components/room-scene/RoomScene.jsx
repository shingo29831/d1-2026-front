import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import GltfErrorBoundary from './GltfErrorBoundary';
import GltfRoom from './GltfRoom';
import PlaceholderRoom from './PlaceholderRoom';
import PersonFigure from '../dashboard/PersonFigure';
import DangerZoneMarkers from './DangerZoneMarkers';
import DoorSensorMarkers from './DoorSensorMarkers';
import CameraMount from './CameraMount';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds } from '../../roomShapes';

function CameraRig({ viewMode, overviewCamera, povCamera }) {
  const { camera } = useThree();
  const controls = useRef();
  const target = viewMode === 'overview' ? overviewCamera : povCamera;

  React.useEffect(() => {
    camera.position.set(...target.position);
    camera.fov = target.fov;
    camera.updateProjectionMatrix();
    if (controls.current) {
      // 俯瞰3Dは常に部屋の中央付近を見る。「カメラの視点」は、実際の見守り
      // カメラの向き(yaw=左右・pitch=上下)の先にある点を見るようにすることで、
      // カメラ位置の設定タブで向き・上下角度を変えた結果がここにも反映される
      // (以前はyaw/pitchに関わらず常に部屋の中央を見ていたため、向きを変えても
      // プレビューに変化が出ないという問題があった)。
      const lookAt = target.lookAt || [0, 0.6, 0];
      controls.current.target.set(...lookAt);
      controls.current.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, target.position[0], target.position[1], target.position[2], target.fov, target.lookAt && target.lookAt[0], target.lookAt && target.lookAt[1], target.lookAt && target.lookAt[2]]);

  return <OrbitControls ref={controls} enableDamping dampingFactor={0.1} minDistance={0.8} maxDistance={24} />;
}

// people: [{ id, floor: {x,z}, fallen, colorState }, ...] 検出された全員分
export default function RoomScene({
  viewMode,
  people,
  modelPath,
  previewFootprint,
  previewHeight,
  previewShapeType,
  previewCameraMount,
  previewCameraYawDeg,
  previewCameraPitchDeg,
  previewCameraFovDeg,
  previewFurniture,
  previewZones,
  previewDoorSensors,
  solidWalls,
}) {
  const {
    footprint: ctxFootprint,
    height: ctxHeight,
    roomShapeType: ctxShapeType,
    roomSize: ctxRoomSize,
    cameraMount: ctxCameraMount,
    cameraYawDeg: ctxYawDeg,
    cameraPitchDeg: ctxPitchDeg,
    cameraFovDeg: ctxFovDeg,
    furniture: ctxFurniture,
    zones: ctxZones,
    doorSensors: ctxDoorSensors,
    customModelUrl,
  } = useRoomConfig();
  const { theme } = useTheme();

  // preview*系は「部屋の設定」「カメラ位置の設定」「家具・エリアの設定」タブで
  // 保存前の編集中の値をその場でプレビューするためのオプション上書き
  // (未指定ならコンテキストの現在値を使う)
  const isRoomPreview = !!previewFootprint;
  const footprint = previewFootprint && previewFootprint.length >= 3 ? previewFootprint : ctxFootprint;
  const height = isRoomPreview && previewHeight != null ? previewHeight : ctxHeight;
  const shapeType = isRoomPreview && previewShapeType ? previewShapeType : ctxShapeType;
  const cameraMount = previewCameraMount || ctxCameraMount;
  const cameraYawDeg = previewCameraYawDeg != null ? previewCameraYawDeg : ctxYawDeg;
  const cameraPitchDeg = previewCameraPitchDeg != null ? previewCameraPitchDeg : ctxPitchDeg;
  const cameraFovDeg = previewCameraFovDeg != null ? previewCameraFovDeg : ctxFovDeg;
  const furniture = previewFurniture || ctxFurniture;
  const zones = previewZones || ctxZones;
  const doorSensors = previewDoorSensors || ctxDoorSensors;
  // 室内の間仕切り壁(walls)は「部屋の設定」タブで自由に追加・移動・削除できる
  // (以前は実際の自宅の間取り専用の固定座標だったため、自由な多角形以外の形
  // では非表示にしていたが、編集可能になった現在はどの形でもそのまま表示する。
  // 部屋の形を変えたときは既存の壁もroomConfigContext.jsx側で範囲内にクランプされる)。
  const showInteriorWalls = true;

  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const roomSize = isRoomPreview
    ? { width: bounds.width, depth: bounds.depth, height }
    : ctxRoomSize;

  // GLTF/GLBモデルは「部屋の設定」タブで明示的にアップロードした場合(customModelUrl)、
  // または呼び出し側が直接指定した場合(modelPath、Polycam動作確認ページなど)のみ読み込む。
  // 【重要】以前はモデル未指定時に既定のROOM_MODEL_PATH(静的なサンプル部屋モデル)を
  // 自動で読み込んでいたが、これだと「部屋の設定」タブで形(長方形/L字型/自由な多角形)や
  // サイズを変更しても、常にこの固定モデルが優先表示されてしまい、変更が一切反映されない
  // という問題があった(静的なGLBは頂点構成が固定のため、選んだ形に追従できないため)。
  // モデル未指定時は、選んだ形にそのまま追従するプレースホルダーの部屋を表示する。
  const path = modelPath || customModelUrl || null;
  const fitTarget = Math.max(roomSize.width, roomSize.depth);
  const list = Array.isArray(people) ? people : [];

  // 俯瞰3D: 部屋のサイズ(バウンディングボックス)に応じて「天井より十分高く、
  // 壁の角にギリギリ寄りすぎない」位置へ自動調整する(固定値だと部屋が大きい/
  // 実写風の不透明な壁を持つモデルの場合に近くの角にめり込んで見えてしまうため)。
  const overviewCamera = useMemo(() => ({
    position: [
      bounds.width * 0.75 + 1.4,
      height * 1.7 + 2.0,
      bounds.depth * 0.75 + 1.4,
    ],
    fov: 45,
  }), [bounds.width, bounds.depth, height]);

  // カメラの視点: 実際に取り付けている見守りカメラ(「カメラ位置の設定」タブで指定)のPOVを再現。
  // 見ている先(lookAt)は、カメラの向き(yaw=左右)と上下角度(pitch)から求めた
  // 方向ベクトルを、設置位置から一定距離(3m)先へ伸ばした点にしている
  // (yawDegToDirと同じsin/cosの向き定義に合わせ、pitchは正の値ほど下向き)。
  const povCamera = useMemo(() => {
    const yawRad = (cameraYawDeg * Math.PI) / 180;
    const pitchRad = (cameraPitchDeg * Math.PI) / 180;
    const lookDist = 3;
    const dirX = Math.sin(yawRad) * Math.cos(pitchRad);
    const dirY = -Math.sin(pitchRad);
    const dirZ = Math.cos(yawRad) * Math.cos(pitchRad);
    return {
      position: [cameraMount.x, cameraMount.y, cameraMount.z],
      fov: cameraFovDeg,
      lookAt: [
        cameraMount.x + dirX * lookDist,
        cameraMount.y + dirY * lookDist,
        cameraMount.z + dirZ * lookDist,
      ],
    };
  }, [cameraMount.x, cameraMount.y, cameraMount.z, cameraYawDeg, cameraPitchDeg, cameraFovDeg]);

  // 床のグリッドは部屋のサイズに合わせて表示する(常に固定サイズの巨大なグリッドを
  // 敷いていると、小さい部屋では間延びして見え、俯瞰視点によっては壁の外側が
  // 急に真っ暗な靄のように見えてしまっていたため、部屋の大きさに応じたサイズにする)
  const gridSize = Math.max(bounds.width, bounds.depth) * 1.6 + 2;
  const gridDivisions = Math.max(4, Math.round(gridSize * 2));

  return (
    <Canvas shadows camera={{ position: overviewCamera.position, fov: overviewCamera.fov }}>
      {/* 背景色をテーマに合わせた明るめの色にし、遠景フォグは使わない。
          以前は黒に近い背景色+濃いフォグの組み合わせのため、俯瞰視点で
          部屋の外側が「黒い霧」のように見えてしまっていた。 */}
      <color attach="background" args={[theme.sceneBg]} />

      <hemisphereLight args={[theme.sceneHemiSky, theme.sceneHemiGround, theme.sceneAmbient]} />
      <directionalLight
        position={[3, 5, 2]}
        intensity={theme.mode === 'dark' ? 1.1 : 0.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.3} color={theme.mode === 'dark' ? '#3366ff' : '#aecdff'} />

      {path ? (
        <GltfErrorBoundary
          resetKey={path}
          fallback={<PlaceholderRoom footprint={previewFootprint} height={isRoomPreview ? previewHeight : undefined} furniture={furniture} showInteriorWalls={showInteriorWalls} solidWalls={solidWalls} />}
        >
          <Suspense fallback={<PlaceholderRoom footprint={previewFootprint} height={isRoomPreview ? previewHeight : undefined} furniture={furniture} showInteriorWalls={showInteriorWalls} solidWalls={solidWalls} />}>
            <GltfRoom path={path} fitTarget={fitTarget} />
          </Suspense>
        </GltfErrorBoundary>
      ) : (
        <PlaceholderRoom footprint={previewFootprint} height={isRoomPreview ? previewHeight : undefined} furniture={furniture} showInteriorWalls={showInteriorWalls} solidWalls={solidWalls} />
      )}

      <CameraMount
        mount={previewCameraMount}
        yawDeg={previewCameraYawDeg}
        pitchDeg={previewCameraPitchDeg}
        fovDeg={previewCameraFovDeg}
      />

      <DangerZoneMarkers peopleFloors={list.map((p) => p.floor)} zones={zones} />
      <DoorSensorMarkers doorSensors={doorSensors} />
      {list.map((p) => (
        <PersonFigure
          key={p.id}
          floor={p.floor}
          fallen={p.fallen}
          colorState={p.colorState}
          dummy={p.dummy}
          selected={p.selected}
          onSelect={p.onSelect}
        />
      ))}

      <gridHelper args={[gridSize, gridDivisions, theme.sceneGrid1, theme.sceneGrid2]} position={[0, 0.001, 0]} />

      <CameraRig viewMode={viewMode} overviewCamera={overviewCamera} povCamera={povCamera} />
    </Canvas>
  );
}
