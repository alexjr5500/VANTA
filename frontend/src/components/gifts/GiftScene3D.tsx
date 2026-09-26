'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Component, ReactNode, useMemo, useRef } from 'react';
import * as THREE from 'three';

type Palette = { a: string; b: string; c: string };
type SceneProps = { id: string; palette: Palette; animate: boolean; quality?: number };

const jewel = { metalness: 0.15, roughness: 0.12, transmission: 0.28, thickness: 1.4 };
const metal = { metalness: 0.9, roughness: 0.18 };
const gold = { metalness: 1, roughness: 0.14, clearcoat: 1 };

function Particles({ color, count = 8 }: { color: string; count?: number }) {
  const points = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [Math.cos(angle) * (1.25 + (i % 3) * 0.18), ((i * 0.63) % 2.5) - 1.1, Math.sin(angle) * 0.45] as const;
  }), [count]);
  return <>{points.map((position, i) => <mesh key={i} position={position} scale={i % 3 === 0 ? 0.08 : 0.045}><sphereGeometry args={[1, 8, 8]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>)}</>;
}

/** Ember rise particles — intense, small, traced along Z so they read as sparks. */
function Embers({ color, count = 5 }: { color: string; count?: number }) {
  const points = useMemo(() => Array.from({ length: count }, (_, i) => {
    return [((i * 1.37) % 2) - 1, 0.55 + (i * 0.29) % 1.1, (((i * 0.91) % 2) - 1) * 0.5] as const;
  }), [count]);
  return <>{points.map((position, i) => <mesh key={i} position={position} scale={0.05}><sphereGeometry args={[1, 8, 8]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>)}</>;
}

function Heart({ p }: { p: Palette }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.9); s.bezierCurveTo(-1.7, 0.05, -1.05, 1.3, 0, 0.62); s.bezierCurveTo(1.05, 1.3, 1.7, 0.05, 0, -0.9);
    return s;
  }, []);
  return <mesh scale={0.86} rotation={[0.08, 0, 0]}><extrudeGeometry args={[shape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 5 }]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.3} {...jewel} /></mesh>;
}

function Love({ p }: { p: Palette }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.9); s.bezierCurveTo(-1.7, 0.05, -1.05, 1.3, 0, 0.62); s.bezierCurveTo(1.05, 1.3, 1.7, 0.05, 0, -0.9);
    return s;
  }, []);
  return <group rotation={[0.1, 0, 0]}>
    <mesh position={[-0.78, 0.06, 0]} scale={0.62}><extrudeGeometry args={[shape, { depth: 0.34, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 4 }]} /><meshPhysicalMaterial color="#ff3d9a" emissive="#8e0e47" emissiveIntensity={0.35} {...jewel} /></mesh>
    <mesh position={[0.78, 0.06, 0]} scale={0.62}><extrudeGeometry args={[shape, { depth: 0.34, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 4 }]} /><meshPhysicalMaterial color="#3ecbff" emissive="#1450e8" emissiveIntensity={0.35} {...jewel} /></mesh>
  </group>;
}

function Crown({ p }: { p: Palette }) {
  return <group rotation={[0.08, 0, 0]}>
    <mesh position={[0, -0.63, 0]}><cylinderGeometry args={[0.92, 0.82, 0.38, 32]} /><meshStandardMaterial color={p.b} {...gold} /></mesh>
    {[-0.72, -0.36, 0, 0.36, 0.72].map((x, i) => <group key={x} position={[x, 0.05 + (i % 2) * 0.13, 0]} rotation={[0, 0, -x * 0.25]}><mesh><coneGeometry args={[0.3, i === 2 ? 1.7 : 1.35, 6]} /><meshStandardMaterial color={i % 2 ? p.a : p.b} {...gold} /></mesh><mesh position={[0, i === 2 ? 0.9 : 0.72, 0.02]}><octahedronGeometry args={[0.12]} /><meshPhysicalMaterial color={i % 2 ? '#62eaff' : '#ff4ca3'} emissive={i % 2 ? '#168eff' : '#a20d6d'} emissiveIntensity={0.8} {...jewel} /></mesh></group>)}
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
  return <group><mesh position={[-0.28, 0.72, -0.05]} rotation={[0, 0, -0.18]}><boxGeometry args={[0.38, 1.15, 0.12]} /><meshStandardMaterial color={first ? '#4f8cff' : p.c} {...gold} /></mesh><mesh position={[0.28, 0.72, -0.05]} rotation={[0, 0, 0.18]}><boxGeometry args={[0.38, 1.15, 0.12]} /><meshStandardMaterial color={first ? '#f34b8d' : p.b} {...gold} /></mesh><mesh position={[0, -0.18, 0.12]}><cylinderGeometry args={[0.78, 0.78, 0.22, 40]} /><meshStandardMaterial color={p.b} {...gold} /></mesh><mesh position={[0, -0.18, 0.26]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.53, 0.07, 10, 32]} /><meshStandardMaterial color={p.a} {...gold} /></mesh><mesh position={[0, -0.16, 0.3]}><octahedronGeometry args={[0.27]} /><meshStandardMaterial color={p.a} {...gold} /></mesh></group>;
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
function Yacht({ p }: { p: Palette }) {
  return <group rotation={[0.06, -0.28, 0]}>
    <mesh position={[0, -0.42, 0]} scale={[1.5, 0.3, 0.5]}><boxGeometry /><meshPhysicalMaterial color="#ffffff" clearcoat={1} metalness={0.4} roughness={0.14} /></mesh>
    <mesh position={[0, 0.1, 0]} scale={[0.52, 0.24, 0.42]}><boxGeometry /><meshPhysicalMaterial color={p.b} clearcoat={1} metalness={0.5} roughness={0.16} /></mesh>
    <mesh position={[-0.44, 0.5, 0]}><cylinderGeometry args={[0.04, 0.06, 1.1, 10]} /><meshStandardMaterial color="#cfd8e8" metalness={0.6} roughness={0.2} /></mesh>
    <mesh position={[0.02, 0.62, 0]} scale={[0.6, 0.3, 0.05]} rotation={[0.1, 0, 0]}><coneGeometry args={[0.5, 1, 4]} /><meshPhysicalMaterial color="#ffffff" emissive={p.a} emissiveIntensity={0.12} clearcoat={1} /></mesh>
    <mesh position={[0.6, -0.05, 0.22]} rotation={[0, 0, -0.5]}><octahedronGeometry args={[0.12]} /><meshBasicMaterial color={p.c} toneMapped={false} /></mesh>
  </group>;
}

function Teddy({ p }: { p: Palette }) {
  const fur = { clearcoat: 0.5, roughness: 0.5 } as const;
  return <group rotation={[0.05, 0, 0]}>
    <mesh position={[-0.44, 0.1, 0]} scale={0.42}><sphereGeometry args={[1, 22, 16]} /><meshPhysicalMaterial color={p.b} {...fur} /></mesh>
    <mesh position={[0.44, 0.1, 0]} scale={0.42}><sphereGeometry args={[1, 22, 16]} /><meshPhysicalMaterial color={p.b} {...fur} /></mesh>
    <mesh position={[0, -0.32, 0]} scale={[0.92, 0.9, 0.7]}><sphereGeometry args={[1, 28, 20]} /><meshPhysicalMaterial color={p.b} {...fur} /></mesh>
    <mesh position={[0, 0.52, 0.06]} scale={0.58}><sphereGeometry args={[1, 28, 20]} /><meshPhysicalMaterial color={p.b} {...fur} /></mesh>
    <mesh position={[0, 0.42, 0.42]} scale={[0.26, 0.18, 0.1]}><sphereGeometry args={[1, 16, 12]} /><meshPhysicalMaterial color="#ffe6c2" roughness={0.5} /></mesh>
    <mesh position={[-0.16, 0.56, 0.5]}><sphereGeometry args={[0.07, 12, 10]} /><meshBasicMaterial color="#241208" /></mesh>
    <mesh position={[0.16, 0.56, 0.5]}><sphereGeometry args={[0.07, 12, 10]} /><meshBasicMaterial color="#241208" /></mesh>
    <mesh position={[0.55, 0.06, 0]} scale={0.3}><sphereGeometry args={[1, 20, 14]} /><meshPhysicalMaterial color="#e84f9e" clearcoat={0.9} roughness={0.25} /></mesh>
  </group>;
}

function Star({ p }: { p: Palette }) {
  return <group rotation={[0.1, 0, 0]}>
    {[0, 72, 144, 216, 288].map((deg, i) => <mesh key={i} rotation={[0, deg * 0.017, 0]}><octahedronGeometry args={[0.78, 1.8]} /><meshPhysicalMaterial color={p.b} emissive={p.a} emissiveIntensity={0.5} {...gold} /></mesh>)}
    <mesh scale={0.55}><octahedronGeometry args={[1, 1]} /><meshPhysicalMaterial color={p.a} emissive={p.b} emissiveIntensity={0.4} {...gold} /></mesh>
  </group>;
}

function Comet({ p }: { p: Palette }) {
  return <group rotation={[0.1, 0, -0.3]}>
    <mesh position={[-1.35, 0, 0]} rotation={[0, 0, 0.5]} scale={[1.9, 0.34, 0.34]}><coneGeometry args={[0.5, 1, 12]} /><meshBasicMaterial color={p.c} toneMapped={false} opacity={0.55} /></mesh>
    <mesh position={[0.05, 0, 0]} scale={0.52}><icosahedronGeometry args={[1, 2]} /><meshPhysicalMaterial color={p.a} emissive={p.b} emissiveIntensity={0.8} {...jewel} /></mesh>
  </group>;
}

function Orb({ p }: { p: Palette }) {
  return <group rotation={[0.1, 0, 0]}>
    <mesh rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.92, 0.07, 10, 40]} /><meshStandardMaterial color={p.a} emissive={p.c} emissiveIntensity={0.4} metalness={0.7} roughness={0.2} /></mesh>
    <mesh><sphereGeometry args={[1, 32, 24]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.5} transmission={0.18} clearcoat={1} roughness={0.1} /></mesh>
  </group>;
}

function Ring({ p }: { p: Palette }) {
  return <group rotation={[0.14, 0, 0]}>
    <mesh rotation={[0, 0, 0]}><torusGeometry args={[0.95, 0.14, 14, 44]} /><meshPhysicalMaterial color={p.b} clearcoat={1} metalness={0.85} roughness={0.14} /></mesh>
    <mesh position={[0, 0.92, 0]} scale={[0.5, 0.4, 0.5]}><octahedronGeometry args={[1, 1.4]} /><meshPhysicalMaterial color="#65f4ff" emissive="#168eff" emissiveIntensity={0.8} {...jewel} /></mesh>
  </group>;
}
function Capsule({ p }: { p: Palette }) {
  return <group rotation={[0.08, -0.25, 0]}>
    <mesh rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.52, 0.9, 10, 24]} /><meshPhysicalMaterial color={p.a} clearcoat={1} metalness={0.7} roughness={0.12} /></mesh>
    <mesh position={[0, 0, 0.34]}><sphereGeometry args={[0.26, 20, 14]} /><meshBasicMaterial color="#eaffff" toneMapped={false} /></mesh>
    <mesh position={[-0.05, 0, 0.34]}><sphereGeometry args={[0.1, 10, 8]} /><meshBasicMaterial color={p.a} toneMapped={false} /></mesh>
  </group>;
}

function Spark({ p }: { p: Palette }) {
  return <group rotation={[0, 0, 0.06]}>
    <mesh position={[0, 0.15, 0]} scale={[0.16, 1.7, 0.16]}><boxGeometry /><meshPhysicalMaterial color={p.b} emissive={p.a} emissiveIntensity={1.2} clearcoat={1} roughness={0.2} /></mesh>
    <mesh position={[0.14, 0.5, 0]} scale={[0.08, 0.5, 0.08]} rotation={[0, 0, -0.5]}><boxGeometry /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
    <mesh position={[-0.12, -0.55, 0]} scale={[0.07, 0.5, 0.07]} rotation={[0, 0, 0.6]}><boxGeometry /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
    <mesh position={[0.1, -1.15, 0]}><octahedronGeometry args={[0.12]} /><meshBasicMaterial color={p.a} toneMapped={false} /></mesh>
  </group>;
}

function Dragon({ p }: { p: Palette }) {
  return <group rotation={[0.06, 0, 0]}>
    <mesh position={[0, -0.1, 0]} scale={[0.8, 0.55, 0.7]}><sphereGeometry args={[1, 24, 18]} /><meshPhysicalMaterial color={p.b} clearcoat={0.7} roughness={0.3} /></mesh>
    <mesh position={[0.55, 0.05, 0]} scale={[0.66, 0.4, 0.5]}><coneGeometry args={[0.9, 1, 12]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.2} clearcoat={0.7} roughness={0.3} /></mesh>
    <mesh position={[0.95, 0.16, -0.14]} rotation={[0, 0, -0.5]}><coneGeometry args={[0.2, 0.7, 8]} /><meshStandardMaterial color="#5c3a14" metalness={0.5} roughness={0.4} /></mesh>
    <mesh position={[0.95, 0.16, 0.14]} rotation={[0, 0, -0.5]}><coneGeometry args={[0.2, 0.7, 8]} /><meshStandardMaterial color="#5c3a14" metalness={0.5} roughness={0.4} /></mesh>
    <mesh position={[0.62, 0.1, 0.2]} scale={0.14}><octahedronGeometry args={[1, 1]} /><meshBasicMaterial color="#ffd166" toneMapped={false} /></mesh>
  </group>;
}

function Castle({ p }: { p: Palette }) {
  return <group rotation={[0.05, 0, 0]}>
    <mesh position={[0, -0.45, 0]} scale={[1.9, 0.9, 0.7]}><boxGeometry /><meshStandardMaterial color={p.c} roughness={0.5} /></mesh>
    {[-0.85, 0.85].map((x, i) => <mesh key={i} position={[x, 0.05, 0]} scale={[0.4, 0.75, 0.4]}><boxGeometry /><meshStandardMaterial color={p.b} roughness={0.4} /></mesh>)}
    {[-0.85, 0.85].map((x, i) => <mesh key={i} position={[x, 0.5, 0]}><coneGeometry args={[0.3, 0.55, 12]} /><meshPhysicalMaterial color={p.a} emissive={p.b} emissiveIntensity={0.25} {...metal} /></mesh>)}
    <mesh position={[0, 0.02, 0]} scale={[0.7, 0.6, 0.4]}><boxGeometry /><meshPhysicalMaterial color={p.b} roughness={0.4} /></mesh>
    <mesh position={[0, 0.42, 0]}><coneGeometry args={[0.26, 0.42, 14]} /><meshStandardMaterial color="#ff4d8f" metalness={0.4} roughness={0.3} /></mesh>
    {[-0.4, 0.4].map((x, i) => <mesh key={i} position={[x, 0.28, 0.26]}><octahedronGeometry args={[0.09]} /><meshBasicMaterial color="#ffd166" toneMapped={false} /></mesh>)}
  </group>;
}

function Sun({ p }: { p: Palette }) {
  return <group rotation={[0.1, 0, 0]}>
    <mesh scale={1.02}><sphereGeometry args={[1, 28, 20]} /><meshPhysicalMaterial color={p.b} emissive={p.a} emissiveIntensity={0.9} clearcoat={0.9} roughness={0.12} /></mesh>
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => <mesh key={i} rotation={[0, 0, deg * 0.017]} scale={i % 2 ? 1.5 : 1.25}><octahedronGeometry args={[0.34, 2.2]} /><meshBasicMaterial color={p.a} toneMapped={false} opacity={0.5} /></mesh>)}
    <mesh scale={0.5}><icosahedronGeometry args={[1, 2]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
  </group>;
}
function Artifact({ p }: { p: Palette }) { return <mesh><icosahedronGeometry args={[1, 2]} /><meshPhysicalMaterial color={p.b} emissive={p.c} emissiveIntensity={0.25} {...jewel} /></mesh>; }

function ObjectForGift({ id, p }: { id: string; p: Palette }) {
  const has = (...keys: string[]) => keys.some(k => id.includes(k));
  if (has('fire') || id === 'flame') return <Flame p={p} />;
  if (has('rose')) return <Rose p={p} />;
  if (has('thumb')) return <Thumb p={p} />;
  if (id === 'happy') return <Happy p={p} />;
  if (has('teddy') || has('bear')) return <Teddy p={p} />;
  if (has('pearl') || has('shell')) return <Pearl p={p} />;
  if (has('medal') || has('place') || has('badge') || has('victory')) return <Medal p={p} first={id.includes('first')} />;
  if (has('diamond') || has('ice') || has('prism') || has('glacier') || has('gem') || has('crystal')) return <Diamond p={p} />;
  if (has('crown') || has('royalty') || has('scepter') || has('crest') || has('throne')) return <Crown p={p} />;
  if (id === 'love') return <Love p={p} />;
  if (has('heart')) return <Heart p={p} />;
  if (has('car') || has('ride') || has('roadster') || has('coupe') || has('velocity')) return <Car p={p} />;
  if (has('jet') || has('flight') || has('wings') || has('elite') || id === 'cloud') return <Jet p={p} />;
  if (has('yacht') || has('boat') || has('sail')) return <Yacht p={p} />;
  if (id === 'star') return <Star p={p} />;
  if (id === 'comet') return <Comet p={p} />;
  if (id === 'orb' || has('sphere')) return <Orb p={p} />;
  if (id === 'ring') return <Ring p={p} />;
  if (id === 'capsule' || id === 'pod') return <Capsule p={p} />;
  if (id === 'spark') return <Spark p={p} />;
  if (id === 'dragon') return <Dragon p={p} />;
  if (id === 'castle') return <Castle p={p} />;
  if (id === 'sun' || has('horizon') || has('sunset') || has('golden')) return <Sun p={p} />;
  return <Artifact p={p} />;
}

function GiftObject({ id, palette: p, animate, quality }: SceneProps) {
  const ref = useRef<THREE.Group>(null);
  const q = Number.isFinite(quality) ? Math.max(0, Math.min(5, quality || 0)) : 1;
  const particleCount = 7 + q * 2;
  useFrame(({ clock }, delta) => {
    if (!animate || !ref.current) return;
    ref.current.rotation.y += delta * 0.42;
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.7) * 0.08;
  });
  return <group ref={ref} scale={0.88}>
    <ObjectForGift id={id} p={p} />
    <Particles color={p.a} count={id.includes('royalty') || id.includes('diamond') || id === 'spark' ? particleCount + 5 : particleCount} />
    {q >= 4 && <Embers color={p.a} count={5} />}
  </group>;
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function GiftScene3D({ id, palette, animate, quality = 1, fallback }: SceneProps & { fallback: ReactNode }) {
  const q = Number.isFinite(quality) ? Math.max(0, Math.min(5, quality || 0)) : 1;
  const rim = q >= 4;
  return <CanvasBoundary fallback={fallback}><Canvas dpr={[1, 1.5]} frameloop={animate ? 'always' : 'demand'} camera={{ position: [0, 0.05, 4.6], fov: 38 }} gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.25; }}>
    <ambientLight intensity={1.35 + q * 0.1} /><directionalLight position={[3, 4, 5]} intensity={3.2 + q * 0.3} color="#ffffff" /><pointLight position={[-3, 1, 2]} intensity={18 + q * 3} distance={7} color={palette.c} /><pointLight position={[3, -2, 2]} intensity={12 + q * 2.4} distance={6} color={palette.a} />
    {rim && <pointLight position={[0, 3, -3]} intensity={14} distance={8} color="#ffffff" />}
    <GiftObject id={id} palette={palette} animate={animate} quality={q} />
  </Canvas></CanvasBoundary>;
}