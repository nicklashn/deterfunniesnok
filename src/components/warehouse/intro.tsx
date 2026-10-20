/**
 * Opening shot: the camera stands in front of the warehouse facade with the company sign, the
 * roller door opens and the camera flies in and up to the overview. Purely decorative.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Layout } from './layout';
import { useSignTexture } from './signs';

export const INTRO_SEC = 7.6;
const FACADE_H = 5.2;
const DOOR_W = 3.8;
const DOOR_H = 3.3;
const SIGN_W = 8.4;
const LAMP_ROWS = 8;

export interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

export const doorX = (L: Layout) => L.storageW / 2;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));
export const doorOpen = (t: number) => seg(t, 1.2, 2.6);
export const facadeOpacity = (t: number) => 1 - seg(t, 4.0, 4.5);
/** Ceiling lamps switch on row by row as the door opens, and fade before the overview. */
const lampOn = (t: number, row: number) => (t >= 2.0 + row * 0.08 ? 1 : 0) * (1 - seg(t, 5.2, 6.2));

/**
 * Camera pose at intro time t (seconds): one continuous spline from the forecourt, through the
 * door and up to the overview pose, so there is no cut. The approach pauses briefly while the
 * door opens.
 */
export function introPose(L: Layout, t: number, end: Pose, out: Pose) {
  const x = doorX(L);
  const front = L.floor.z1 + 0.15;
  const pos = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x + 3, 3.0, front + 20),
    new THREE.Vector3(x, 1.9, front + 8),
    new THREE.Vector3(x, 1.4, front + 0.3),
    new THREE.Vector3(x, 2.4, front - 1.2),
    new THREE.Vector3(THREE.MathUtils.lerp(x, end.pos.x, 0.5), end.pos.y * 0.55, THREE.MathUtils.lerp(front - 1, end.pos.z, 0.35)),
    end.pos,
  ], false, 'centripetal');
  const look = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, 2.8, front),
    new THREE.Vector3(x, 2.4, front),
    new THREE.Vector3(x, 1.4, front - 6),
    new THREE.Vector3(x, 0.6, front - 9),
    new THREE.Vector3().lerpVectors(new THREE.Vector3(x, 0.6, front - 9), end.look, 0.6),
    end.look,
  ], false, 'centripetal');
  const u = t < 2.2 ? 0.2 * seg(t, 0, 2.2) : 0.2 + 0.8 * seg(t, 2.2, INTRO_SEC);
  pos.getPoint(u, out.pos);
  look.getPoint(u, out.look);
}

/** Lamp rows hanging over the floor during the intro. */
export function CeilingLamps({ L, clock }: { L: Layout; clock: React.RefObject<{ t: number; active: boolean }> }) {
  const group = useRef<THREE.Group>(null);
  const mats = useMemo(
    () => Array.from({ length: LAMP_ROWS }, () => new THREE.MeshStandardMaterial({ color: '#3a3f4a', emissive: '#fff1cf', emissiveIntensity: 0, transparent: true })),
    [],
  );
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const x0 = L.floor.x0 + 1;
  const x1 = L.beltX;
  const rows = Array.from({ length: LAMP_ROWS }, (_, r) => L.floor.z1 - 1 - (r * (L.floor.z1 - L.floor.z0 - 2)) / (LAMP_ROWS - 1));
  useFrame(() => {
    const c = clock.current!;
    group.current!.visible = c.active;
    if (!c.active) return;
    mats.forEach((m, r) => {
      const k = lampOn(c.t, r);
      m.emissiveIntensity = k * 1.6;
      m.opacity = 1 - seg(c.t, 5.2, 6.2);
    });
    lights.current.forEach((l, i) => l && (l.intensity = lampOn(c.t, i * 3) * 14));
  });
  return (
    <group ref={group}>
      {rows.map((z, r) => (
        <mesh key={r} material={mats[r]} position={[(x0 + x1) / 2, 4.4, z]}>
          <boxGeometry args={[x1 - x0, 0.05, 0.14]} />
        </mesh>
      ))}
      {[0, 3, 6].map((r, i) => (
        <pointLight key={r} ref={(l) => { lights.current[i] = l; }} position={[(x0 + x1) / 2, 4.1, rows[r]]} color="#fff1cf" intensity={0} distance={18} decay={1.3} />
      ))}
    </group>
  );
}

export function Facade({ L, company, logo, clock }: {
  L: Layout;
  company: string;
  logo: string | null;
  clock: React.RefObject<{ t: number; active: boolean }>;
}) {
  const x0 = L.floor.x0 - 0.3;
  const x1 = L.floor.x1 + 0.3;
  const z = L.floor.z1 + 0.15;
  const dx = doorX(L);
  const group = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);

  const sign = useSignTexture(company || 'Lager', logo, { w: 2000, h: 340, bg: '#14161b', fg: '#f3f4f6', stripe: '#e0b84c' });
  const mats = useMemo(
    () => ({
      wall: new THREE.MeshStandardMaterial({ color: '#59606e', roughness: 0.8, flatShading: true, transparent: true }),
      rib: new THREE.MeshStandardMaterial({ color: '#4a505c', roughness: 0.8, flatShading: true, transparent: true }),
      trim: new THREE.MeshStandardMaterial({ color: '#e0b84c', roughness: 0.6, transparent: true }),
      door: new THREE.MeshStandardMaterial({ color: '#8d939f', roughness: 0.5, metalness: 0.3, flatShading: true, transparent: true }),
      slat: new THREE.MeshStandardMaterial({ color: '#737a87', roughness: 0.5, transparent: true }),
      lamp: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd27a', emissiveIntensity: 2, transparent: true }),
      ground: new THREE.MeshStandardMaterial({ color: '#25282f', roughness: 1, transparent: true }),
      sign: new THREE.MeshBasicMaterial({ map: sign, transparent: true, toneMapped: false }),
    }),
    [sign],
  );

  useFrame(() => {
    const c = clock.current!;
    const g = group.current!;
    g.visible = c.active && facadeOpacity(c.t) > 0;
    if (!g.visible) return;
    const o = facadeOpacity(c.t);
    Object.values(mats).forEach((m) => (m.opacity = o));
    door.current!.scale.y = 1 - doorOpen(c.t) * 0.94;
  });

  const ribs = useMemo(() => {
    const out: number[] = [];
    for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.1) if (Math.abs(x - dx) > SIGN_W / 2 + 0.35) out.push(x);
    return out;
  }, [x0, x1, dx]);

  const leftW = dx - DOOR_W / 2 - x0;
  const rightW = x1 - (dx + DOOR_W / 2);
  return (
    <group ref={group} position={[0, 0, z]}>
      {/* Forecourt */}
      <mesh material={mats.ground} rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2 + 4, -0.005, 10]}>
        <planeGeometry args={[x1 - x0 + 30, 20]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.trim} rotation={[-Math.PI / 2, 0, 0]} position={[dx + s * (DOOR_W / 2 + 0.3), 0.002, 4]}>
          <planeGeometry args={[0.1, 8]} />
        </mesh>
      ))}
      <mesh material={mats.wall} position={[x0 + leftW / 2, FACADE_H / 2, 0]}>
        <boxGeometry args={[leftW, FACADE_H, 0.3]} />
      </mesh>
      <mesh material={mats.wall} position={[x1 - rightW / 2, FACADE_H / 2, 0]}>
        <boxGeometry args={[rightW, FACADE_H, 0.3]} />
      </mesh>
      <mesh material={mats.wall} position={[dx, (DOOR_H + FACADE_H) / 2, 0]}>
        <boxGeometry args={[DOOR_W, FACADE_H - DOOR_H, 0.3]} />
      </mesh>
      {ribs.map((x) => (
        <mesh key={x} material={mats.rib} position={[x, FACADE_H / 2, 0.18]}>
          <boxGeometry args={[0.12, FACADE_H, 0.06]} />
        </mesh>
      ))}
      {/* Parapet and door frame */}
      <mesh material={mats.trim} position={[(x0 + x1) / 2, FACADE_H + 0.06, 0]}>
        <boxGeometry args={[x1 - x0 + 0.1, 0.12, 0.4]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={mats.trim} position={[dx + s * (DOOR_W / 2 + 0.08), DOOR_H / 2, 0.08]}>
          <boxGeometry args={[0.16, DOOR_H, 0.3]} />
        </mesh>
      ))}
      {/* Roller door, rolls up from the bottom */}
      <group ref={door} position={[dx, DOOR_H, 0]}>
        <mesh material={mats.door} position={[0, -DOOR_H / 2, 0]}>
          <boxGeometry args={[DOOR_W, DOOR_H, 0.12]} />
        </mesh>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} material={mats.slat} position={[0, -0.16 - i * 0.33, 0.07]}>
            <boxGeometry args={[DOOR_W, 0.03, 0.02]} />
          </mesh>
        ))}
      </group>
      {/* Company sign above the door */}
      <mesh material={mats.sign} position={[dx, DOOR_H + (FACADE_H - DOOR_H) / 2 + 0.05, 0.32]}>
        <planeGeometry args={[SIGN_W, SIGN_W * (340 / 2000)]} />
      </mesh>
      {/* Wall lamps */}
      {[-1, 1].map((s) => (
        <group key={s} position={[dx + s * (DOOR_W / 2 + 0.9), DOOR_H - 0.3, 0.25]}>
          <mesh material={mats.lamp}>
            <boxGeometry args={[0.36, 0.16, 0.2]} />
          </mesh>
          <pointLight color="#ffd9a0" intensity={6} distance={7} decay={1.6} position={[0, -0.2, 0.8]} />
        </group>
      ))}
    </group>
  );
}
