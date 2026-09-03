'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Component, ReactNode, useMemo, useRef } from 'react';
import * as THREE from 'three';

type Palette = { a: string; b: string; c: string };
type SceneProps = { id: string; palette: Palette; animate: boolean };

const jewel = { metalness: 0.15, roughness: 0.12, transmission: 0.28, thickness: 1.4 };
const metal = { metalness: 0.9, roughness: 0.18 };

function Particles({ color, count = 8 }: { color: string; count?: number }) {
  const points = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [Math.cos(angle) * (1.25 + (i % 3) * 0.18), ((i * 0.63) % 2.5) - 1.1, Math.sin(angle) * 0.45] as const;
  }), [count]);
  return <>{points.map((position, i) => <mesh key={i} position={position} scale={i % 3 === 0 ? 0.08 : 0.045}><sphereGeometry args={[1, 8, 8]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>)}</>;
}

function Heart({ p }: { p: Palette }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.9); s.bezierCurveTo(-1.7, 0.05, -1.05, 1.3, 0, 0.62); s.bezierCurveTo(1.05, 1.3, 1.7, 0.05, 0, -0.9);
    return s;
  }, []);
  return <mesh scale={0.86} rotation={[0.08, 0, 0]}><extrudeGeometry args={[shape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 5 }]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.3} {...jewel} /></mesh>;
}

function Crown({ p }: { p: Palette }) {
  return <group rotation={[0.08, 0, 0]}>
    <mesh position={[0, -0.63, 0]}><cylinderGeometry args={[0.92, 0.82, 0.38, 32]} /><meshStandardMaterial color={p.b} {...metal} /></mesh>
    {[-0.72, -0.36, 0, 0.36, 0.72].map((x, i) => <group key={x} position={[x, 0.05 + (i % 2) * 0.13, 0]} rotation={[0, 0, -x * 0.25]}><mesh><coneGeometry args={[0.3, i === 2 ? 1.7 : 1.35, 6]} /><meshStandardMaterial color={i % 2 ? p.a : p.b} {...metal} /></mesh><mesh position={[0, i === 2 ? 0.9 : 0.72, 0.02]}><octahedronGeometry args={[0.12]} /><meshPhysicalMaterial color={i % 2 ? '#62eaff' : '#ff4ca3'} emissive={i % 2 ? '#168eff' : '#a20d6d'} emissiveIntensity={0.8} {...jewel} /></mesh></group>)}
  </group>;
}

function Flame({ p }: { p: Palette }) {
  return <group rotation={[0, 0, -0.08]}>
    <mesh scale={[0.78, 1.45, 0.62]}><coneGeometry args={[0.82, 1.9, 18]} /><meshStandardMaterial color={p.c} emissive={p.c} emissiveIntensity={1.4} roughness={0.35} /></mesh>
    <mesh position={[0.05, -0.2, 0.42]} scale={[0.55, 1.03, 0.4]}><coneGeometry args={[0.72, 1.7, 18]} /><meshStandardMaterial color={p.b} emissive={p.b} emissiveIntensity={1.8} roughness={0.3} /></mesh>
    <mesh position={[0.08, -0.42, 0.72]} scale={[0.32, 0.65, 0.25]}><coneGeometry args={[0.65, 1.45, 16]} /><meshBasicMaterial color={p.a} toneMapped={false} /></mesh>
  </group>;
}

function Rose({ p }: { p: Palette }) {
  return <group rotation={[0, 0, -0.14]}>
    <mesh position={[0, -0.65, 0]}><cylinderGeometry args={[0.055, 0.075, 1.9, 12]} /><meshStandardMaterial color="#1dac70" roughness={0.45} /></mesh>
    {[0, 1, 2, 3, 4, 5, 6].map(i => { const a = i * Math.PI * 2 / 7; return <mesh key={i} position={[Math.cos(a) * 0.42, 0.45 + Math.sin(a) * 0.22, Math.sin(a) * 0.28]} scale={[0.55, 0.35, 0.24]} rotation={[a * 0.25, a, a]}><sphereGeometry args={[1, 24, 16]} /><meshPhysicalMaterial color={i % 2 ? p.b : p.a} clearcoat={0.65} roughness={0.24} /></mesh>; })}
    <mesh position={[0, 0.5, 0.35]} scale={[0.42, 0.42, 0.32]}><sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color={p.c} roughness={0.2} /></mesh>
    <mesh position={[-0.35, -0.45, 0]} rotation={[0, 0, -0.8]} scale={[0.42, 0.18, 0.06]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#32d88b" /></mesh>
  </group>;
}

function Medal({ p, first }: { p: Palette; first: boolean }) {
  return <group><mesh position={[-0.28, 0.72, -0.05]} rotation={[0, 0, -0.18]}><boxGeometry args={[0.38, 1.15, 0.12]} /><meshStandardMaterial color={first ? '#4f8cff' : p.c} {...metal} /></mesh><mesh position={[0.28, 0.72, -0.05]} rotation={[0, 0, 0.18]}><boxGeometry args={[0.38, 1.15, 0.12]} /><meshStandardMaterial color={first ? '#f34b8d' : p.b} {...metal} /></mesh><mesh position={[0, -0.18, 0.12]}><cylinderGeometry args={[0.78, 0.78, 0.22, 40]} /><meshStandardMaterial color={p.b} {...metal} /></mesh><mesh position={[0, -0.18, 0.26]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.53, 0.07, 10, 32]} /><meshStandardMaterial color={p.a} {...metal} /></mesh><mesh position={[0, -0.16, 0.3]}><octahedronGeometry args={[0.27]} /><meshStandardMaterial color={p.a} {...metal} /></mesh></group>;
}

function Pearl({ p }: { p: Palette }) {
  return <group><mesh position={[0, -0.42, 0]} scale={[1.2, 0.42, 0.9]}><sphereGeometry args={[1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshPhysicalMaterial color={p.c} iridescence={0.8} roughness={0.22} metalness={0.25} side={THREE.DoubleSide} /></mesh><mesh position={[0, 0.15, -0.34]} rotation={[-0.75, 0, 0]} scale={[1.13, 0.38, 0.88]}><sphereGeometry args={[1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshPhysicalMaterial color={p.b} iridescence={0.9} roughness={0.2} side={THREE.DoubleSide} /></mesh><mesh position={[0, -0.05, 0.2]}><sphereGeometry args={[0.48, 32, 24]} /><meshPhysicalMaterial color="#ffffff" emissive={p.a} emissiveIntensity={0.2} iridescence={1} clearcoat={1} roughness={0.08} /></mesh></group>;
}

function Diamond({ p }: { p: Palette }) { return <mesh rotation={[0.15, 0, 0]} scale={[0.88, 1.15, 0.88]}><octahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.18} transmission={0.55} thickness={2.4} ior={2.1} metalness={0.08} roughness={0.05} clearcoat={1} /></mesh>; }

function Car({ p }: { p: Palette }) {
  return <group rotation={[0.08, -0.35, 0]}><mesh scale={[1.35, 0.34, 0.62]}><boxGeometry /><meshPhysicalMaterial color={p.b} clearcoat={1} metalness={0.65} roughness={0.12} /></mesh><mesh position={[0, 0.37, -0.03]} scale={[0.72, 0.33, 0.5]}><boxGeometry /><meshPhysicalMaterial color="#91edff" transmission={0.38} metalness={0.3} roughness={0.1} /></mesh>{[-0.82, 0.82].flatMap(x => [-0.46, 0.46].map(z => <mesh key={`${x}${z}`} position={[x, -0.34, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.27, 0.27, 0.18, 20]} /><meshStandardMaterial color="#090b16" metalness={0.7} roughness={0.35} /></mesh>))}<mesh position={[1.37, 0, 0.32]}><sphereGeometry args={[0.12, 12, 10]} /><meshBasicMaterial color={p.a} toneMapped={false} /></mesh><mesh position={[1.37, 0, -0.32]}><sphereGeometry args={[0.12, 12, 10]} /><meshBasicMaterial color={p.a} toneMapped={false} /></mesh></group>;
}

function Jet({ p }: { p: Palette }) {
  return <group rotation={[0.15, 0, -0.18]}><mesh rotation={[0, 0, -Math.PI / 2]} scale={[1.4, 0.3, 0.3]}><capsuleGeometry args={[0.4, 1.6, 8, 20]} /><meshPhysicalMaterial color={p.a} clearcoat={1} metalness={0.7} roughness={0.13} /></mesh><mesh scale={[1.45, 0.08, 0.78]}><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color={p.b} {...metal} /></mesh><mesh position={[-0.92, 0.12, 0]} scale={[0.46, 0.38, 0.62]}><coneGeometry args={[1, 1, 4]} /><meshStandardMaterial color={p.c} {...metal} /></mesh><mesh position={[1.12, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.32, 0.75, 20]} /><meshStandardMaterial color={p.a} {...metal} /></mesh></group>;
}

function Thumb({ p }: { p: Palette }) { return <group rotation={[0, 0, -0.22]}><mesh position={[-0.35, -0.42, 0]} scale={[0.48, 0.82, 0.42]}><capsuleGeometry args={[0.55, 0.75, 8, 18]} /><meshPhysicalMaterial color={p.b} clearcoat={1} metalness={0.4} roughness={0.18} /></mesh><mesh position={[0.28, -0.12, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[0.58, 1.2, 0.55]}><capsuleGeometry args={[0.44, 0.95, 8, 18]} /><meshPhysicalMaterial color={p.b} clearcoat={1} metalness={0.4} roughness={0.18} /></mesh><mesh position={[-0.03, 0.76, 0]} rotation={[0, 0, -0.55]} scale={[0.42, 0.95, 0.42]}><capsuleGeometry args={[0.45, 0.9, 8, 18]} /><meshPhysicalMaterial color={p.a} clearcoat={1} metalness={0.35} roughness={0.16} /></mesh></group>; }

function Happy({ p }: { p: Palette }) { return <group><mesh position={[0, 0.2, 0]}><sphereGeometry args={[0.9, 28, 20]} /><meshPhysicalMaterial color={p.b} clearcoat={0.8} roughness={0.2} /></mesh><mesh position={[-0.32, 0.38, 0.77]}><sphereGeometry args={[0.1, 12, 10]} /><meshBasicMaterial color="#151327" /></mesh><mesh position={[0.32, 0.38, 0.77]}><sphereGeometry args={[0.1, 12, 10]} /><meshBasicMaterial color="#151327" /></mesh><mesh position={[0, -0.05, 0.78]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.3, 0.065, 8, 20, Math.PI]} /><meshBasicMaterial color="#ffffff" /></mesh><mesh position={[0, 1.05, 0]}><coneGeometry args={[0.55, 1.1, 18]} /><meshStandardMaterial color={p.c} metalness={0.35} roughness={0.2} /></mesh></group>; }

function Artifact({ p }: { p: Palette }) { return <mesh><icosahedronGeometry args={[1, 2]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.25} {...jewel} /></mesh>; }

function ObjectForGift({ id, p }: { id: string; p: Palette }) {
  if (id.includes('fire')) return <Flame p={p} />;
  if (id.includes('rose')) return <Rose p={p} />;
  if (id.includes('diamond') || id.includes('ice')) return <Diamond p={p} />;
  if (id.includes('crown') || id.includes('royalty')) return <Crown p={p} />;
  if (id.includes('heart') || id.includes('love')) return <Heart p={p} />;
  if (id.includes('medal') || id.includes('place')) return <Medal p={p} first={id.includes('first')} />;
  if (id.includes('ride')) return <Car p={p} />;
  if (id.includes('pearl')) return <Pearl p={p} />;
  if (id.includes('thumb')) return <Thumb p={p} />;
  if (id.includes('elite') || id.includes('jet')) return <Jet p={p} />;
  if (id.includes('happy')) return <Happy p={p} />;
  return <Artifact p={p} />;
}

function GiftObject({ id, palette: p, animate }: SceneProps) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }, delta) => {
    if (!animate || !ref.current) return;
    ref.current.rotation.y += delta * 0.42;
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.7) * 0.08;
  });
  return <group ref={ref} scale={0.88}><ObjectForGift id={id} p={p} /><Particles color={p.a} count={id.includes('royalty') || id.includes('diamond') ? 12 : 7} /></group>;
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function GiftScene3D({ id, palette, animate, fallback }: SceneProps & { fallback: ReactNode }) {
  return <CanvasBoundary fallback={fallback}><Canvas dpr={[1, 1.5]} frameloop={animate ? 'always' : 'demand'} camera={{ position: [0, 0.05, 4.6], fov: 38 }} gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.25; }}>
    <ambientLight intensity={1.35} /><directionalLight position={[3, 4, 5]} intensity={3.2} color="#ffffff" /><pointLight position={[-3, 1, 2]} intensity={18} distance={7} color={palette.c} /><pointLight position={[3, -2, 2]} intensity={12} distance={6} color={palette.a} />
    <GiftObject id={id} palette={palette} animate={animate} />
  </Canvas></CanvasBoundary>;
}