import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// フロア座標上に人物を表す、頭・胴体・腕(上腕/前腕/手)・脚(太もも/すね/足)を
// 個別のパーツで組み立てたリアル寄りの人型アバターを描画する。
// YOLOv8-Poseは単眼2Dのため関節ごとの正確な3D位置までは再現できないので、
// 実際の関節角度に追従させるのではなく「自然に立った姿勢のマネキン」を検出した
// フロア座標に配置し、転倒時は全身をまとめて横倒しにする、という分かりやすい
// 表現にしている(以前の「カプセル1本+頭」の簡易表現から、肩・肘・股関節・膝を
// 持つ多パーツ構成に変更し、見た目のリアルさを向上させた)。
//
// 【歩行モーション】
// 目標のフロア座標(floor)へ毎フレーム少しずつ追従(lerp)させているが、その
// 移動量(1フレームあたりの実際の位置変化)が一定以上あれば「歩行中」とみなし、
// 股関節(hipRefs)・膝(kneeRefs)・肩(shoulderRefs)の回転を、左右逆位相の
// サインカーブでアニメーションさせている(=歩くたびに脚と腕が振れる)。
// 止まる/歩き出すときは振幅(walkAmpRef)を滑らかに0↔1へ補間することで、
// 急に足踏みが始まったり止まったりする不自然さを抑えている。
// ダミー(矢印キーで移動)・実際のYOLO検出(pose-dataの座標が動く)のどちらでも、
// 「floorの座標が動いている間は歩いて見える」という同じ仕組みで動作する。
//
// 【よりリアルに見せるための追加要素】
// ・進行方向を向く: 実際の移動量(dx, dz)から進行方向の角度を求め、体全体
//   (rotation.y)をその方向へ滑らかに回転させる(=横や後ろに滑るように移動する
//   不自然さを解消)。止まっている間は最後に向いていた方向を保持する。
// ・上下の弾み: 歩行中は一歩ごとに(1サイクルにつき2回)わずかに上下する
//   (|sin|カーブ)。実際に人が歩くときの重心の上下動を簡易的に再現している。
// ・前のめりの姿勢: 歩行中は上体をわずかに前へ傾ける。
// ・歩く速さに応じた足の回転速度: 実際の移動速度(m/s換算)に応じて脚を振る
//   周期を速めたり遅めたりする(ゆっくり動くときはゆっくり、速く動くときは
//   速く脚が動く)。
//
// dummy: trueの場合、「ダミーを置く」ボタンで手動配置した人物であることを
// 紫系の色で示す(実際の検出結果と見分けられるように)。selectedがtrueの
// ダミーは矢印キーでの移動対象になっており、リングを強調表示する。
// onSelectが渡されている場合はクリックでそのダミーを選択できる。
export default function PersonFigure({ floor, fallen, colorState, dummy, selected, onSelect }) {
  const group = useRef();

  // 歩行アニメーション用の参照(左=0, 右=1)
  const hipRefs = useRef([null, null]);
  const kneeRefs = useRef([null, null]);
  const shoulderRefs = useRef([null, null]);
  const walkPhase = useRef(0);
  const walkAmp = useRef(0);
  const prevGroupPos = useRef(null);
  const heading = useRef(0); // 現在向いている角度(rotation.y)。停止中は最後の値を保持する
  const bodyPivot = useRef(); // 前のめり姿勢・上下の弾みを適用する内側グループ

  const color = dummy
    ? (selected ? '#a78bfa' : '#8b5cf6')
    : (colorState === 'danger' ? '#f43f5e' : colorState === 'warning' ? '#f59e0b' : '#67e8f9');
  const skinColor = '#f8fafc';

  useFrame((_, delta) => {
    if (!group.current || !floor) return;

    // 目標位置へ滑らかに追従(急なワープを避ける)
    const target = new THREE.Vector3(floor.x, 0, floor.z);
    const beforePos = group.current.position.clone();
    group.current.position.lerp(target, 0.25);

    // このフレームで実際にどれだけ動いたか(=歩行中かどうかの判定に使う)
    const moved = prevGroupPos.current ? group.current.position.distanceTo(prevGroupPos.current) : 0;
    const dx = group.current.position.x - beforePos.x;
    const dz = group.current.position.z - beforePos.z;
    prevGroupPos.current = group.current.position.clone();
    const isWalking = !fallen && moved > 0.0008;

    // 歩き出す/止まるときに振幅を滑らかに0↔1へ補間(急な足踏み開始/停止を防ぐ)
    walkAmp.current = THREE.MathUtils.lerp(walkAmp.current, isWalking ? 1 : 0, 0.12);

    // 実際の移動速度(m/s換算。1フレームの移動量をdeltaで割る)に応じて歩幅の
    // 周期を速めたり遅めたりする。速すぎる瞬間値でブレないよう、上限でクランプ。
    const speed = delta > 0 ? moved / delta : 0;
    const BASE_STEP_SPEED = 8.5; // 従来の固定値(基準となる歩行速度での周期)
    const REFERENCE_SPEED = 1.2; // このm/s相当で基準周期になるよう正規化
    const speedFactor = THREE.MathUtils.clamp(speed / REFERENCE_SPEED, 0.6, 1.8);
    if (isWalking || walkAmp.current > 0.01) {
      walkPhase.current += delta * BASE_STEP_SPEED * speedFactor;
    }
    const amp = walkAmp.current;
    const phase = walkPhase.current;

    // 進行方向を向く: 実際に移動した向き(dx, dz)から目標角度を求め、最短経路で
    // 滑らかに回転させる(角度の境界±πをまたぐときに逆回転しないよう正規化する)。
    // 止まっている間(移動がほぼ無い間)は最後に向いていた方向を保持する。
    if (isWalking) {
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - heading.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // [-π, π]に正規化
      heading.current += diff * 0.2;
    }
    group.current.rotation.y = heading.current;

    // 立ち姿の基準角度(度ではなくラジアン。以前の静止姿勢と同じ値)
    const HIP_BASE = 0.08;
    const KNEE_BASE = -0.12;
    const SHOULDER_BASE = 0.1;

    [0, 1].forEach((i) => {
      const phaseOffset = i === 0 ? 0 : Math.PI; // 左右の脚は逆位相で振る
      const legSwing = Math.sin(phase + phaseOffset) * 0.45 * amp;
      const kneeLift = Math.max(0, Math.sin(phase + phaseOffset + 0.6)) * 0.55 * amp;
      if (hipRefs.current[i]) hipRefs.current[i].rotation.x = HIP_BASE + legSwing;
      if (kneeRefs.current[i]) kneeRefs.current[i].rotation.x = KNEE_BASE - kneeLift;

      // 腕は対側の脚と同位相で振る(右脚が前に出るとき左腕が前に出る、自然な歩行動作)
      const armPhaseOffset = i === 0 ? Math.PI : 0;
      const armSwing = Math.sin(phase + armPhaseOffset) * 0.35 * amp;
      if (shoulderRefs.current[i]) shoulderRefs.current[i].rotation.x = SHOULDER_BASE + armSwing;
    });

    // 上下の弾み: 1歩ごと(1サイクルにつき2回)に重心がわずかに上下する様子を
    // |sin|カーブで簡易的に再現する(歩いていないときは0に収束)。腰の高さ(0.56)
    // を基準に、そこからの上下動として加える。
    const bob = Math.abs(Math.sin(phase)) * 0.035 * amp;
    if (bodyPivot.current) {
      bodyPivot.current.position.y = 0.56 + bob;
      // 前のめりの姿勢: 歩行中は腰を軸に上体(胴体・頭・腕)をわずかに前へ傾ける
      // (脚は接地したままなので、脚だけが独立して歩く不自然さを避けられる)。
      const targetLean = fallen ? 0 : 0.09 * amp;
      bodyPivot.current.rotation.x = THREE.MathUtils.lerp(bodyPivot.current.rotation.x, targetLean, 0.2);
    }

    const targetRotX = fallen ? Math.PI / 2 : 0;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, targetRotX, 0.25);
  });

  if (!floor) return null;

  const bodyMat = { color, roughness: 0.4, metalness: 0.15, emissive: color, emissiveIntensity: 0.2 };
  const skinMat = { color: skinColor, roughness: 0.55 };

  return (
    <group
      ref={group}
      position={[floor.x, 0, floor.z]}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
    >
      {/* --- 脚(左右対称。股関節(hipRefs)と膝(kneeRefs)をそれぞれ独立した
            回転ピボットにして、歩行時にuseFrame内から角度を操作できるようにしている) --- */}
      {[-1, 1].map((side, i) => (
        <group
          key={`leg-${side}`}
          ref={(el) => { hipRefs.current[i] = el; }}
          position={[0.09 * side, 0.56, 0]}
          rotation={[0.08, 0, 0.05 * side]}
        >
          {/* 太もも(股関節→膝) */}
          <mesh position={[0, -0.13, 0]} castShadow>
            <capsuleGeometry args={[0.065, 0.2, 4, 10]} />
            <meshStandardMaterial {...bodyMat} />
          </mesh>
          {/* すね〜足(膝から下) */}
          <group
            ref={(el) => { kneeRefs.current[i] = el; }}
            position={[0, -0.26, 0]}
            rotation={[-0.12, 0, 0]}
          >
            <mesh position={[0, -0.12, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.2, 4, 10]} />
              <meshStandardMaterial {...bodyMat} />
            </mesh>
            {/* 足 */}
            <mesh position={[0, -0.24, 0.02]} castShadow>
              <boxGeometry args={[0.075, 0.05, 0.16]} />
              <meshStandardMaterial {...bodyMat} />
            </mesh>
          </group>
        </group>
      ))}

      {/* --- 骨盤・胴体・首・頭・腕をまとめた上半身ピボット(bodyPivot) ---
            腰の高さ(0.56)を基準点にして、歩行時の上下の弾み(position.y)と
            前のめりの姿勢(rotation.x)をuseFrame内からまとめて適用できるように
            している。子要素の座標は、このピボット(y=0.56)からの相対値。 */}
      <group ref={bodyPivot} position={[0, 0.56, 0]}>
        {/* --- 骨盤・胴体 --- */}
        <mesh position={[0, 0.02, 0]} castShadow>
          <capsuleGeometry args={[0.1, 0.06, 4, 10]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
        <mesh position={[0, 0.26, 0]} castShadow>
          <capsuleGeometry args={[0.135, 0.24, 4, 12]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>

        {/* --- 首・頭 --- */}
        <mesh position={[0, 0.42, 0]} castShadow>
          <capsuleGeometry args={[0.04, 0.02, 4, 8]} />
          <meshStandardMaterial {...skinMat} />
        </mesh>
        <mesh position={[0, 0.53, 0]} castShadow>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial {...skinMat} />
        </mesh>

        {/* --- 腕(左右対称。肩(shoulderRefs)を歩行時の振り用ピボットにしている) --- */}
        {[-1, 1].map((side, i) => (
          <group
            key={`arm-${side}`}
            ref={(el) => { shoulderRefs.current[i] = el; }}
            position={[0.16 * side, 0.38, 0]}
            rotation={[0.1, 0, 0.32 * side]}
          >
            {/* 上腕(肩→肘) */}
            <mesh position={[0, -0.09, 0]} castShadow>
              <capsuleGeometry args={[0.045, 0.14, 4, 10]} />
              <meshStandardMaterial {...bodyMat} />
            </mesh>
            {/* 前腕〜手(肘から下。内側へ軽く曲げる) */}
            <group position={[0, -0.17, 0]} rotation={[0.35, 0, 0.15 * side]}>
              <mesh position={[0, -0.09, 0]} castShadow>
                <capsuleGeometry args={[0.038, 0.13, 4, 10]} />
                <meshStandardMaterial {...bodyMat} />
              </mesh>
              <mesh position={[0, -0.18, 0]} castShadow>
                <sphereGeometry args={[0.042, 10, 10]} />
                <meshStandardMaterial {...skinMat} />
              </mesh>
            </group>
          </group>
        ))}
      </group>

      {/* 足元のマーカーリング(選択中のダミーは太く強調表示) */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={selected ? [0.26, 0.36, 32] : [0.24, 0.3, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}
