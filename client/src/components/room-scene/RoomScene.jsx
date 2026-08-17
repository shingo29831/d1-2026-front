import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import GltfErrorBoundary from './GltfErrorBoundary';
import GltfRoom from './GltfRoom';
import PlaceholderRoom from './PlaceholderRoom';
import PersonFigure from '../dashboard/PersonFigure';
import DangerZoneMarkers from './DangerZoneMarkers';
import DoorSensorMarkers from './DoorSensorMarkers';
import RiskSuggestionMarkers from './RiskSuggestionMarkers';
import CameraMount from './CameraMount';
import HeatmapOverlay3D from './HeatmapOverlay3D';
import HeatmapHotspots from './HeatmapHotspots';
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary';
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
  previewCameraRangeM,
  previewFurniture,
  previewZones,
  previewDoorSensors,
  solidWalls,
  showHeatmap,
  heatmapIncidents,
  riskSuggestions,
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
  // 【重要・不具合修正】「壁に固定」モードでは、cameraMount.x/zは壁の中心線
  // (roomShapes.jsのnearestEdgePointが返す、壁の厚み0.08mの箱ジオメトリの
  // まさに中心)にぴったり合わせて配置される。そのため、以前はPOVカメラの
  // 位置をcameraMountの座標そのまま使っていたため、カメラが壁のメッシュの
  // 内部から始まってしまい、ニアクリップ面が壁を突き抜けて、画面全体が
  // 壁の内側に埋まったように見える(手前の壁が画面いっぱいに歪んで見える)
  // 不具合があった。カメラが向いている方向(yaw)へわずかに(壁の厚みより
  // 十分外側に出る距離)前進させた位置を実際の視点位置とすることで、壁の
  // メッシュの外(部屋の内側)からPOVが始まるようにしている。
  // 「自由配置」モードなど壁際でない場合でも、この程度のオフセットは
  // 見た目にほとんど影響しない。
  const WALL_CLEARANCE_M = 0.18;
  const povCamera = useMemo(() => {
    const yawRad = (cameraYawDeg * Math.PI) / 180;
    const pitchRad = (cameraPitchDeg * Math.PI) / 180;
    const lookDist = 3;
    const dirX = Math.sin(yawRad) * Math.cos(pitchRad);
    const dirY = -Math.sin(pitchRad);
    const dirZ = Math.cos(yawRad) * Math.cos(pitchRad);
    // 前進オフセットは上下角度(pitch)の影響を受けない水平方向(yaw)成分のみ
    // で計算する(壁は垂直面のため、壁から離れる方向は常に水平でよい)。
    const clearX = Math.sin(yawRad) * WALL_CLEARANCE_M;
    const clearZ = Math.cos(yawRad) * WALL_CLEARANCE_M;
    const povX = cameraMount.x + clearX;
    const povY = cameraMount.y;
    const povZ = cameraMount.z + clearZ;
    return {
      position: [povX, povY, povZ],
      fov: cameraFovDeg,
      lookAt: [
        povX + dirX * lookDist,
        povY + dirY * lookDist,
        povZ + dirZ * lookDist,
      ],
    };
  }, [cameraMount.x, cameraMount.y, cameraMount.z, cameraYawDeg, cameraPitchDeg, cameraFovDeg]);

  return (
    // Canvas(WebGL)内で何らかの例外が起きても画面全体が真っ白にならないよう、
    // この3D表示部分だけを局所的に受け止めるエラー境界で包む。
    <Canvas3DErrorBoundary>
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

      {/* 「カメラの視点」表示中は、見ている本人の視点のすぐそば(あるいは
          視界の中)にカメラ自身の筐体・レンズ・視野角の扇形を表示しても
          意味がなく、むしろ視界の邪魔になるだけなので非表示にする
          (自由視点や各設定タブのプレビューでは従来通り表示する)。 */}
      {viewMode !== 'pov' && (
        <CameraMount
          mount={previewCameraMount}
          yawDeg={previewCameraYawDeg}
          pitchDeg={previewCameraPitchDeg}
          fovDeg={previewCameraFovDeg}
          rangeM={previewCameraRangeM}
        />
      )}

      <DangerZoneMarkers peopleFloors={list.map((p) => p.floor)} zones={zones} />
      <DoorSensorMarkers doorSensors={doorSensors} />
      {riskSuggestions && <RiskSuggestionMarkers suggestions={riskSuggestions} />}
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

      {/* 「見守りダッシュボードにもヒートマップを表示できるボタンがほしい」という
          要望を受けて追加した、危険行為の履歴に基づく発生密度ヒートマップの重ね
          表示。「危険行為の履歴」タブの3Dヒートマップと同じ計算(incidentHeatmap.js)
          を使う。既定では非表示で、StatusBarの「ヒートマップ」ボタンを押した
          ときだけ表示する(showHeatmap)。 */}
      {showHeatmap && (
        <HeatmapOverlay3D incidents={heatmapIncidents} footprint={footprint} />
      )}

      {/* 「ヒートマップボタンを押したらそこから吹き出しが出て、危険行為が多い
          場所で何が起きたか＋直近3件を見られるようにしてほしい」という要望を
          受けて追加。上のHeatmapOverlay3D(色の濃淡)とは別に、実際の履歴を
          クリック可能な件数バッジとして重ね、押すとカテゴリ内訳+直近3件の
          吹き出しを開く。表示条件はHeatmapOverlay3Dと同じ(showHeatmap)。 */}
      {showHeatmap && (
        <HeatmapHotspots incidents={heatmapIncidents} />
      )}

      {/* 【不具合修正】以前は床にgridHelper(方眼状の網目模様)を重ねて表示していたが、
          「3D表示の下のあみあみ(網目)を消してほしい」という要望を受けて削除した。
          床のサイズ感は床面(PlaceholderRoom.jsxのmeshStandardMaterial)自体の
          陰影・部屋の外形線だけで十分伝わるため、削除しても部屋の見え方に支障はない。 */}

      <CameraRig viewMode={viewMode} overviewCamera={overviewCamera} povCamera={povCamera} />
    </Canvas>
    </Canvas3DErrorBoundary>
  );
}
