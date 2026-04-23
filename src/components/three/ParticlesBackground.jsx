import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial, Icosahedron } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme } from '../../hooks/useTheme.jsx';

function FloatingBall({ theme }) {
  const ref = useRef();
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.x += delta * 0.15;
    ref.current.rotation.y += delta * 0.2;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.25;
  });

  const isLight = theme === 'light';
  return (
    <Icosahedron ref={ref} args={[1.4, 1]} position={[2.2, 0, -2]}>
      <meshStandardMaterial
        color={isLight ? '#0ea5e9' : '#22d3ee'}
        emissive={isLight ? '#0369a1' : '#0ea5e9'}
        emissiveIntensity={isLight ? 0.15 : 0.35}
        wireframe
      />
    </Icosahedron>
  );
}

function Particles({ theme, count = 1800 }) {
  const ref = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 8;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    return arr;
  }, [count]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.03;
    ref.current.rotation.x += delta * 0.01;
  });

  const isLight = theme === 'light';
  return (
    <Points ref={ref} positions={positions} stride={3} frustumCulled>
      <PointMaterial
        transparent
        color={isLight ? '#0f172a' : '#a5f3fc'}
        opacity={isLight ? 0.55 : 1}
        size={isLight ? 0.022 : 0.015}
        sizeAttenuation
        depthWrite={false}
        blending={isLight ? THREE.NormalBlending : THREE.AdditiveBlending}
      />
    </Points>
  );
}

export default function ParticlesBackground() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div
      className="bg-particles fixed inset-0 -z-10 pointer-events-none"
      key={theme}
    >
      <Canvas
        camera={{ position: [0, 0, 4], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={isLight ? 0.7 : 0.45} />
        <pointLight
          position={[5, 5, 5]}
          intensity={isLight ? 0.9 : 1.2}
          color={isLight ? '#0ea5e9' : '#22d3ee'}
        />
        <pointLight
          position={[-5, -3, -5]}
          intensity={isLight ? 0.5 : 0.8}
          color={isLight ? '#6366f1' : '#ef4444'}
        />
        <Suspense fallback={null}>
          <Particles theme={theme} />
          <FloatingBall theme={theme} />
        </Suspense>
      </Canvas>
    </div>
  );
}
