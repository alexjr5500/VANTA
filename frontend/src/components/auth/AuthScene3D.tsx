'use client';

import { Component, ReactNode, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, Line, MeshReflectorMaterial, RoundedBox, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

type SceneMode = 'login' | 'register';
type SceneProps = { mode: SceneMode; compact?: boolean; reducedMotion?: boolean };

class WebGLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function CameraRig({ reducedMotion = false, compact = false }: Pick<SceneProps, 'reducedMotion' | 'compact'>) {
  const { camera, pointer } = useThree();
  const base = useMemo(() => new THREE.Vector3(compact ? 0.7 : 0.45, compact ? 0.4 : 0.15, compact ? 10.8 : 11.8), [compact]);
  const target = useMemo(() => new THREE.Vector3(0, 0.25, 0), []);

  useFrame((_, delta) => {
    const motion = reducedMotion ? 0 : 1;
    const desiredX = base.x + pointer.x * (compact ? 0.15 : 0.38) * motion;
    const desiredY = base.y + pointer.y * (compact ? 0.08 : 0.2) * motion;
    const easing = 1 - Math.exp(-delta * 2.4);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredX, easing);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredY, easing);
    camera.lookAt(target.x + pointer.x * 0.08 * motion, target.y + pointer.y * 0.04 * motion, target.z);
  });
  return null;
}

function PortalFrame({ scale, depth, color, roughness = 0.22 }: { scale: number; depth: number; color: string; roughness?: number }) {
  const material = <meshStandardMaterial color="#242424" metalness={0.88} roughness={roughness} emissive={color} emissiveIntensity={0.18} />;
  return (
    <group position={[0, 0.25, depth]} scale={scale}>
      <RoundedBox args={[0.62, 5.55, 0.72]} radius={0.16} smoothness={3} position={[-2.05, 0, 0]} castShadow receiveShadow>{material}</RoundedBox>
      <RoundedBox args={[0.62, 5.55, 0.72]} radius={0.16} smoothness={3} position={[2.05, 0, 0]} castShadow receiveShadow>{material}</RoundedBox>
      <RoundedBox args={[4.68, 0.62, 0.72]} radius={0.16} smoothness={3} position={[0, 2.47, 0]} castShadow receiveShadow>{material}</RoundedBox>
      <mesh position={[0, -2.52, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.65, 0.2, 0.8]} />
        {material}
      </mesh>
    </group>
  );
}

function Humanoid({ reducedMotion = false }: Pick<SceneProps, 'reducedMotion'>) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current && !reducedMotion) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.42) * 0.035;
  });
  const body = <meshStandardMaterial color="#0a0a0a" metalness={0.35} roughness={0.62} />;
  return (
    <group ref={group} position={[0, -1.16, 1.3]} scale={0.9}>
      <mesh position={[0, 2.05, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.29, 24, 18]} />{body}
      </mesh>
      <mesh position={[0, 1.17, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.43, 1.12, 8, 18]} />{body}
      </mesh>
      <mesh position={[-0.54, 1.17, 0]} rotation={[0, 0, -0.13]} castShadow>
        <capsuleGeometry args={[0.13, 1.3, 6, 12]} />{body}
      </mesh>
      <mesh position={[0.54, 1.17, 0]} rotation={[0, 0, 0.13]} castShadow>
        <capsuleGeometry args={[0.13, 1.3, 6, 12]} />{body}
      </mesh>
      <mesh position={[-0.23, 0.02, 0]} rotation={[0, 0, 0.025]} castShadow>
        <capsuleGeometry args={[0.17, 1.45, 6, 12]} />{body}
      </mesh>
      <mesh position={[0.23, 0.02, 0]} rotation={[0, 0, -0.025]} castShadow>
        <capsuleGeometry args={[0.17, 1.45, 6, 12]} />{body}
      </mesh>
    </group>
  );
}

function PortalWorld({ compact = false, reducedMotion = false }: Omit<SceneProps, 'mode'>) {
  const world = useRef<THREE.Group>(null);
  useFrame(({ clock, pointer }) => {
    if (!world.current) return;
    world.current.rotation.y = THREE.MathUtils.lerp(world.current.rotation.y, reducedMotion ? 0 : pointer.x * 0.022, 0.025);
    world.current.position.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.34) * 0.025;
  });
  const architecture = compact ? 5 : 9;
  return (
    <>
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#080808', 9, 24]} />
      <ambientLight intensity={0.24} color="#666666" />
      <directionalLight position={[-5, 8, 6]} intensity={1.35} color="#d8d8d8" castShadow={!compact} shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 1.8, 2.7]} intensity={28} distance={9} decay={2} color="#ffffff" castShadow={!compact} />
      <pointLight position={[2.8, 0.4, 1]} intensity={18} distance={8} decay={2} color="#8a8a8a" />
      <spotLight position={[-3, 6, 5]} target-position={[0, 0, 0]} intensity={18} angle={0.28} penumbra={0.9} color="#b8b8b8" />

      <group ref={world} position={[compact ? 1.4 : 0.25, 0.2, 0]} scale={compact ? 0.76 : 1}>
        <mesh position={[0, 0.4, -1.95]}>
          <boxGeometry args={[5.15, 6.35, 0.18]} />
          <meshStandardMaterial color="#181818" emissive="#777777" emissiveIntensity={0.08} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.3, -1.7]}>
          <planeGeometry args={[4.1, 5.25]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <PortalFrame scale={1.14} depth={-1.25} color="#555555" roughness={0.4} />
        <PortalFrame scale={1.07} depth={-0.55} color="#777777" />
        <PortalFrame scale={1} depth={0.18} color="#b8b8b8" roughness={0.15} />
        <PortalFrame scale={0.9} depth={0.72} color="#ffffff" roughness={0.18} />
        <Humanoid reducedMotion={reducedMotion} />
        <mesh position={[0, -2.05, 1.18]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 1.75, 64]} />
        <meshBasicMaterial color="#b8b8b8" transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>

      {Array.from({ length: architecture }, (_, index) => {
        const side = index % 2 ? 1 : -1;
        const x = side * (4.2 + (index % 3) * 1.55);
        const z = -2.5 - (index % 4) * 2.2;
        const height = 5 + (index % 3) * 2.1;
        return <RoundedBox key={index} args={[1.2 + (index % 2) * 0.55, height, 1.5]} radius={0.12} smoothness={2} position={[x, height / 2 - 2.8, z]} rotation={[0, side * 0.08, side * 0.025]} castShadow receiveShadow><meshStandardMaterial color="#101010" metalness={0.72} roughness={0.55} /></RoundedBox>;
      })}
      {!compact && <>
        <RoundedBox args={[2.4, 8.5, 2.6]} radius={0.15} smoothness={2} position={[-6.6, 1.1, 4.2]} rotation={[0, -0.22, 0.04]}><meshStandardMaterial color="#080808" metalness={0.6} roughness={0.68} /></RoundedBox>
        <RoundedBox args={[2.1, 7.6, 2.2]} radius={0.15} smoothness={2} position={[7.2, 0.7, 2.6]} rotation={[0, 0.25, -0.03]}><meshStandardMaterial color="#101010" metalness={0.6} roughness={0.68} /></RoundedBox>
      </>}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.6, 0]} receiveShadow>
        <planeGeometry args={[35, 35]} />
        <MeshReflectorMaterial color="#0a0a0a" metalness={0.82} roughness={0.34} mirror={0.4} blur={compact ? [80, 24] : [220, 60]} resolution={compact ? 256 : 512} mixBlur={1.5} mixStrength={1.1} depthScale={0.8} minDepthThreshold={0.3} maxDepthThreshold={1.4} />
      </mesh>
      {[[-2.8, -2.57, 1], [2.8, -2.57, 1], [-5.4, -2.57, -2], [5.4, -2.57, -2]].map((position, index) => <mesh key={index} position={position as [number, number, number]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.035, 16]} /><meshBasicMaterial color={index % 2 ? '#b8b8b8' : '#777777'} toneMapped={false} /></mesh>)}
      <Sparkles count={compact ? 18 : 48} scale={[12, 7, 14]} size={compact ? 1.4 : 2.1} speed={reducedMotion ? 0 : 0.12} opacity={0.32} color="#d8d8d8" />
    </>
  );
}

const nodeData = [
  { p: [-3.7, 1.9, 1.8], c: '#f5f5f5', s: 0.62 }, { p: [3.65, 1.3, 0.5], c: '#b8b8b8', s: 0.53 },
  { p: [-3.25, -1.7, -0.6], c: '#8a8a8a', s: 0.47 }, { p: [3.25, -1.9, 2.2], c: '#d8d8d8', s: 0.7 },
  { p: [-0.75, 3.5, -1.5], c: '#b8b8b8', s: 0.4 }, { p: [1.15, -3.3, -1.9], c: '#777777', s: 0.38 },
] as const;

function CreatorBeacon({ position, color, scale, index, reducedMotion }: { position: readonly [number, number, number]; color: string; scale: number; index: number; reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return;
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.55 + index * 1.3) * 0.12;
    ref.current.rotation.y += 0.003 + index * 0.0002;
  });
  return (
    <group ref={ref} position={[...position]} scale={scale}>
      <mesh castShadow>
        <sphereGeometry args={[0.72, 28, 20]} />
        <meshStandardMaterial color="#161616" metalness={0.7} roughness={0.24} emissive={color} emissiveIntensity={0.22} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.9, 0.075, 12, 48]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      <mesh position={[0, 0, 0.7]}><circleGeometry args={[0.4, 32]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} roughness={0.28} /></mesh>
      <mesh position={[0.62, -0.55, 0.6]}><sphereGeometry args={[0.11, 16, 12]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
      <pointLight intensity={5} distance={2.5} color={color} />
    </group>
  );
}

function NetworkCore({ reducedMotion = false }: Pick<SceneProps, 'reducedMotion'>) {
  const sphere = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (sphere.current && !reducedMotion) {
      sphere.current.rotation.y += delta * 0.07;
      sphere.current.rotation.x += delta * 0.018;
    }
  });
  return (
    <group ref={sphere}>
      <mesh receiveShadow>
        <sphereGeometry args={[2.35, 64, 48]} />
        <meshPhysicalMaterial color="#202020" metalness={0.35} roughness={0.22} transmission={0.16} transparent opacity={0.86} emissive="#777777" emissiveIntensity={0.08} />
      </mesh>
      <mesh scale={1.015}>
        <icosahedronGeometry args={[2.35, 3]} />
        <meshBasicMaterial color="#b8b8b8" wireframe transparent opacity={0.38} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2.7, 0.15, 0]}><torusGeometry args={[2.82, 0.022, 8, 160]} /><meshBasicMaterial color="#f5f5f5" transparent opacity={0.7} toneMapped={false} /></mesh>
      <mesh rotation={[Math.PI / 2, 0.7, 0.35]}><torusGeometry args={[3.18, 0.018, 8, 160]} /><meshBasicMaterial color="#8a8a8a" transparent opacity={0.52} toneMapped={false} /></mesh>
      <pointLight position={[0, 0, 1.5]} intensity={18} distance={8} color="#ffffff" />
      <pointLight position={[-1.4, 0.8, 1]} intensity={14} distance={7} color="#8a8a8a" />
    </group>
  );
}

function NetworkWorld({ compact = false, reducedMotion = false }: Omit<SceneProps, 'mode'>) {
  const root = useRef<THREE.Group>(null);
  const visibleNodes = compact ? nodeData.slice(0, 4) : nodeData;
  const links = useMemo(() => visibleNodes.map(({ p }): [THREE.Vector3Tuple, THREE.Vector3Tuple] => [
    [0, 0, 0],
    [p[0] * 0.82, p[1] * 0.82, p[2] * 0.82],
  ]), [visibleNodes]);
  useFrame(({ pointer }) => {
    if (!root.current) return;
    root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, reducedMotion ? 0 : pointer.x * 0.045, 0.025);
    root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, reducedMotion ? 0 : -pointer.y * 0.025, 0.025);
  });
  return (
    <>
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#080808', 10, 27]} />
      <ambientLight intensity={0.34} color="#666666" />
      <directionalLight position={[5, 6, 8]} intensity={1.8} color="#d8d8d8" />
      <pointLight position={[-5, 2, 3]} intensity={16} distance={11} color="#ffffff" />
      <group ref={root} position={[compact ? 1.35 : 0.25, compact ? 0.1 : 0.35, 0]} scale={compact ? 0.76 : 1}>
        <NetworkCore reducedMotion={reducedMotion} />
        {links.map((points, index) => <Line key={index} points={points} color="#b8b8b8" lineWidth={0.7} transparent opacity={0.24} />)}
        {visibleNodes.map(({ p, c, s }, index) => <CreatorBeacon key={index} position={p} color={c} scale={s} index={index} reducedMotion={reducedMotion} />)}
      </group>
      {Array.from({ length: compact ? 4 : 9 }, (_, index) => {
        const side = index % 2 ? 1 : -1;
        return <Float key={index} speed={reducedMotion ? 0 : 0.28} rotationIntensity={0.08} floatIntensity={0.18}><RoundedBox args={[1.5, 0.16, 1.05]} radius={0.08} smoothness={2} position={[side * (4.5 + index * 0.48), -2.3 + (index % 3) * 1.7, -4 - (index % 4) * 2.1]} rotation={[0.12, side * 0.3, 0]}><meshStandardMaterial color="#101010" metalness={0.78} roughness={0.38} /></RoundedBox></Float>;
      })}
      <Sparkles count={compact ? 24 : 66} scale={[15, 9, 16]} size={compact ? 1.3 : 2} speed={reducedMotion ? 0 : 0.1} opacity={0.35} color="#d8d8d8" />
    </>
  );
}

function Fallback({ mode }: { mode: SceneMode }) {
  return <div className={`auth-webgl-fallback auth-webgl-fallback-${mode}`}><span aria-hidden="true" /></div>;
}

export default function AuthScene3D({ mode, compact = false, reducedMotion = false }: SceneProps) {
  return (
    <WebGLBoundary fallback={<Fallback mode={mode} />}>
      <Canvas
        className="auth-canvas"
        dpr={compact ? 1 : [1, 1.5]}
        frameloop={reducedMotion ? 'demand' : 'always'}
        shadows={!compact}
        camera={{ position: [compact ? 0.7 : 0.45, compact ? 0.4 : 0.15, compact ? 10.8 : 11.8], fov: compact ? 42 : 38, near: 0.1, far: 45 }}
        gl={{ antialias: !compact, alpha: false, powerPreference: 'high-performance', stencil: false }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
        }}
      >
        <CameraRig compact={compact} reducedMotion={reducedMotion} />
        {mode === 'login' ? <PortalWorld compact={compact} reducedMotion={reducedMotion} /> : <NetworkWorld compact={compact} reducedMotion={reducedMotion} />}
      </Canvas>
    </WebGLBoundary>
  );
}