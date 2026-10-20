/** Low-poly models built from primitive shapes. No external assets. */
import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHELF_D, SHELF_H, SHELF_W, type Layout, type ShelfPos } from './layout';
import { MAX_PACKAGES, MAX_TICKETS, pileCount, type Sim } from './sim';
import { useSignTexture } from './signs';

type V3 = [number, number, number];
type SimRef = React.RefObject<Sim>;

export const PALETTE = {
  background: '#16181d',
  floor: '#3c414c',
  wall: '#4b515e',
  dark: '#262a33',
  rack: '#d9822b',
  board: '#5d6577',
  cardboard: '#b88a5a',
  cardboard2: '#a67a4c',
  tape: '#e4c06a',
  belt: '#1c1f26',
  accent: '#e0b84c',
};

function Box({ size, position, color, emissive, intensity = 0, shadow = true }: {
  size: V3; position: V3; color: string; emissive?: string; intensity?: number; shadow?: boolean;
}) {
  return (
    <mesh position={position} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} emissive={emissive ?? '#000'} emissiveIntensity={intensity} roughness={0.85} flatShading />
    </mesh>
  );
}

function FloorPatch({ x, z, w, d, color }: { x: number; z: number; w: number; d: number; color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006, z]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/* ───────────── Building ───────────── */

export const Building = memo(function Building({ L }: { L: Layout }) {
  const { x0, x1, z0, z1 } = L.floor;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const doorA = L.dockZ - 1.3;
  const doorB = L.dockZ + 1.3;
  const storageEnd = L.aisleZ[L.aisleZ.length - 1] + 2.5;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={PALETTE.floor} roughness={0.95} />
      </mesh>
      {/* Yard outside the dock */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x1 + 7, -0.01, cz + 6]} receiveShadow>
        <planeGeometry args={[14, d + 24]} />
        <meshStandardMaterial color="#202329" roughness={1} />
      </mesh>
      {/* Zones */}
      <FloorPatch x={-4.7} z={(z0 + L.board.z + 0.6) / 2} w={5.6} d={L.board.z + 0.6 - z0} color="#434858" />
      <FloorPatch x={L.storageW / 2} z={(z0 + storageEnd) / 2 + 0.4} w={L.storageW + 1.2} d={storageEnd - z0 - 0.4} color="#41465a" />
      {/* Aisle edge markings */}
      {L.aisleZ.flatMap((az) => [az - 1.3, az + 1.3]).map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[L.storageW / 2, 0.012, z]}>
          <planeGeometry args={[L.storageW, 0.06]} />
          <meshBasicMaterial color={PALETTE.accent} />
        </mesh>
      ))}
      {/* Walls: full height at the back and left, low cut-away on the right */}
      <Box size={[w + 0.6, 3, 0.3]} position={[cx, 1.5, z0 - 0.15]} color={PALETTE.wall} />
      <Box size={[0.3, 3, d]} position={[x0 - 0.15, 1.5, cz]} color={PALETTE.wall} />
      <Box size={[0.3, 0.9, doorA - z0]} position={[x1 + 0.15, 0.45, (z0 + doorA) / 2]} color={PALETTE.wall} />
      <Box size={[0.3, 0.9, z1 - doorB]} position={[x1 + 0.15, 0.45, (doorB + z1) / 2]} color={PALETTE.wall} />
      {[doorA, doorB].map((z) => (
        <Box key={z} size={[0.3, 2.4, 0.25]} position={[x1 + 0.15, 1.2, z]} color={PALETTE.accent} />
      ))}
    </group>
  );
});

/** Company name on top of the back wall, facing the camera. */
export function WallSign({ L, company, logo }: { L: Layout; company: string; logo: string | null }) {
  const tex = useSignTexture(company, logo, { w: 2000, h: 300, bg: '#14161b', fg: '#f3f4f6', stripe: PALETTE.accent });
  const w = Math.min(12, Math.max(7, L.storageW));
  return (
    <group position={[L.storageW / 2, 6.1, L.floor.z0 - 0.1]}>
      <Box size={[w + 0.2, w * 0.15 + 0.2, 0.2]} position={[0, 0, -0.12]} color={PALETTE.dark} />
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[w, w * 0.15]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.14, 3.2, 0.14]} position={[s * w * 0.35, -2.4, -0.12]} color={PALETTE.dark} />
      ))}
    </group>
  );
}

/* ───────────── Shelves ───────────── */

const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

export const Shelf = memo(function Shelf({ s, index, color }: { s: ShelfPos; index: number; color: string }) {
  const boxes = useMemo(() => {
    const out: { p: V3; s: V3; c: string }[] = [];
    [0.2, 0.9, 1.6].forEach((y, level) => {
      let x = -SHELF_W / 2 + 0.12;
      for (let k = 0; k < 5; k++) {
        const r = rand(index * 31 + level * 7 + k);
        const w = 0.3 + r * 0.22;
        const h = 0.28 + rand(r * 100) * 0.26;
        if (x + w > SHELF_W / 2 - 0.08) break;
        out.push({ p: [x + w / 2, y + 0.03 + h / 2, 0], s: [w, h, SHELF_D * 0.75], c: r > 0.75 ? color : r > 0.4 ? PALETTE.cardboard : PALETTE.cardboard2 });
        x += w + 0.06;
      }
    });
    return out;
  }, [index, color]);

  return (
    <group position={[s.x, 0, s.z]}>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <Box key={`${sx}${sz}`} size={[0.08, SHELF_H, 0.08]} position={[(sx * SHELF_W) / 2, SHELF_H / 2, (sz * SHELF_D) / 2]} color={PALETTE.rack} />
      )))}
      {[0.17, 0.87, 1.57, 2.17].map((y) => (
        <Box key={y} size={[SHELF_W, 0.05, SHELF_D]} position={[0, y, 0]} color={PALETTE.board} />
      ))}
      {boxes.map((b, i) => (
        <Box key={i} size={b.s} position={b.p} color={b.c} />
      ))}
      <Box size={[SHELF_W, 0.12, 0.04]} position={[0, 2.06, (s.facing * SHELF_D) / 2 + 0.03]} color={color} shadow={false} />
    </group>
  );
});

/** Sales column on top of a shelf; height follows the exact unit share (smoothed). */
export function SalesColumn({ s, color, height, leader }: { s: ShelfPos; color: string; height: number; leader: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const h = THREE.MathUtils.damp(m.scale.y, Math.max(0.02, height), 10, dt);
    m.scale.y = h;
    m.position.y = SHELF_H + 0.05 + h / 2;
  });
  return (
    <mesh ref={ref} position={[s.x, SHELF_H, s.z]} castShadow>
      <boxGeometry args={[1.3, 1, 0.42]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={leader ? 0.35 : 0.08} roughness={0.6} />
    </mesh>
  );
}

/* ───────────── Leader marker ───────────── */

export function LeaderMarker({ s, height }: { s: ShelfPos; height: number }) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const last = useRef(s);
  const pulse = useRef(0);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    if (last.current !== s) {
      last.current = s;
      pulse.current = 1;
    }
    const y = SHELF_H + height + 0.5 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    g.position.x = THREE.MathUtils.damp(g.position.x, s.x, 6, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, s.z, 6, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, y, 6, dt);
    g.rotation.y += dt * 0.8;

    const r = ring.current!;
    pulse.current = Math.max(0, pulse.current - dt * 0.8);
    r.visible = pulse.current > 0;
    r.position.set(s.x, 0.03, s.z);
    r.scale.setScalar(1 + (1 - pulse.current) * 3);
    (r.material as THREE.MeshBasicMaterial).opacity = pulse.current * 0.8;
  });
  return (
    <>
      <group ref={ref} position={[s.x, 4, s.z]}>
        <mesh castShadow>
          <octahedronGeometry args={[0.24, 0]} />
          <meshStandardMaterial color={PALETTE.accent} emissive={PALETTE.accent} emissiveIntensity={0.4} metalness={0.3} roughness={0.4} flatShading />
        </mesh>
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.05, 40]} />
        <meshBasicMaterial color={PALETTE.accent} transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

/* ───────────── People ───────────── */

const VESTS = ['#e8c547', '#e07b39', '#e8c547', '#5f8dd3', '#e07b39', '#e8c547', '#5f8dd3', '#e07b39'];
const SKIN = ['#f1c7a5', '#c68b63', '#8d5a3b', '#e8b48f'];

function Person({ vest, skin, legs }: { vest: string; skin: string; legs?: React.Ref<THREE.Group>[] }) {
  return (
    <>
      {[-1, 1].map((side, i) => (
        <group key={side} ref={legs?.[i]} position={[side * 0.1, 0.46, 0]}>
          <Box size={[0.13, 0.46, 0.15]} position={[0, -0.23, 0]} color="#2c3140" />
        </group>
      ))}
      <mesh position={[0, 0.74, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.24, 0.58, 7]} />
        <meshStandardMaterial color={vest} flatShading roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.17, 0]} castShadow>
        <icosahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color={skin} flatShading />
      </mesh>
      <mesh position={[0, 1.3, 0.02]}>
        <cylinderGeometry args={[0.17, 0.18, 0.08, 7]} />
        <meshStandardMaterial color="#2c3140" flatShading />
      </mesh>
    </>
  );
}

export function Workers({ sim, count, colors }: { sim: SimRef; count: number; colors: string[] }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <WorkerModel key={i} index={i} sim={sim} colors={colors} />
      ))}
    </>
  );
}

function WorkerModel({ index, sim, colors }: { index: number; sim: SimRef; colors: string[] }) {
  const group = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const carry = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const w = sim.current?.workers[index];
    const g = group.current;
    if (!w || !g) return;
    g.visible = w.vis > 0.01;
    g.scale.setScalar(1.3 * (1 - (1 - w.vis) ** 3));
    g.position.x = w.x;
    g.position.z = w.z;
    let diff = w.heading - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 12);
    const walking = w.path.length > 0;
    const swing = walking ? Math.sin(w.walk) * 0.6 : 0;
    legL.current!.rotation.x = THREE.MathUtils.damp(legL.current!.rotation.x, swing, 20, dt);
    legR.current!.rotation.x = THREE.MathUtils.damp(legR.current!.rotation.x, -swing, 20, dt);
    g.position.y = walking ? Math.abs(Math.sin(w.walk)) * 0.05 : 0;
    const c = carry.current!;
    const holding = w.task === 'toPack' || w.task === 'dropping' || (w.task === 'picking' && w.timer < 0.15);
    c.visible = holding;
    if (holding) {
      (c.material as THREE.MeshStandardMaterial).color.set(colors[w.shelf] ?? PALETTE.cardboard);
      c.scale.setScalar(0.8 + Math.min(w.carry, 6) * 0.07);
    }
  });
  return (
    <group ref={group} scale={1.3}>
      <Person vest={VESTS[index % VESTS.length]} skin={SKIN[index % SKIN.length]} legs={[legL, legR]} />
      <mesh ref={carry} position={[0, 0.85, 0.34]} castShadow visible={false}>
        <boxGeometry args={[0.36, 0.28, 0.3]} />
        <meshStandardMaterial color={PALETTE.cardboard} flatShading />
      </mesh>
    </group>
  );
}

/* ───────────── Sales team ───────────── */

export function SalesDesks({ sim, L }: { sim: SimRef; L: Layout }) {
  const screens = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const board = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const s = sim.current;
    if (!s) return;
    s.deskFlash.forEach((f, i) => {
      const m = screens.current[i];
      if (m) m.emissiveIntensity = 0.35 + f * 1.4;
    });
    if (board.current) board.current.emissiveIntensity = 0.35 + Math.max(0, ...s.deskFlash) * 0.5;
  });
  return (
    <group>
      {L.desks.map((d, i) => (
        <group key={i} position={[d.x, 0, d.z]}>
          <Box size={[1.5, 0.08, 0.8]} position={[0, 0.74, 0]} color="#c9ccd4" />
          <Box size={[0.08, 0.72, 0.7]} position={[-0.68, 0.36, 0]} color="#8a8f9c" />
          <Box size={[0.08, 0.72, 0.7]} position={[0.68, 0.36, 0]} color="#8a8f9c" />
          <mesh position={[0, 1.08, -0.18]} castShadow>
            <boxGeometry args={[0.7, 0.45, 0.05]} />
            <meshStandardMaterial ref={(m) => { screens.current[i] = m; }} color="#1b1e25" emissive="#8fb3e8" emissiveIntensity={0.35} />
          </mesh>
          <Box size={[0.08, 0.2, 0.08]} position={[0, 0.88, -0.2]} color={PALETTE.dark} />
          <group position={[0, -0.18, 0.55]} rotation={[0, Math.PI, 0]}>
            <Person vest={['#5f8dd3', '#7a8597', '#4f9c8c'][i % 3]} skin={SKIN[(i + 1) % SKIN.length]} />
          </group>
          <Box size={[0.5, 0.06, 0.5]} position={[0, 0.42, 0.6]} color={PALETTE.dark} />
        </group>
      ))}
      {/* Order board where tickets land */}
      <group position={[L.board.x, 0, L.board.z]}>
        <Box size={[0.1, 1.4, 0.1]} position={[0, 0.7, 0]} color="#8a8f9c" />
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[1.7, 1, 0.08]} />
          <meshStandardMaterial ref={board} color="#1b1e25" emissive="#8fb3e8" emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

export function Tickets({ sim, L }: { sim: SimRef; L: Layout }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const s = sim.current;
    if (!s) return;
    s.tickets.forEach((t, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.visible = t.active;
      if (!t.active) return;
      const d = L.desks[t.desk] ?? L.desks[0];
      const k = ease(t.t);
      m.position.set(
        THREE.MathUtils.lerp(d.x, L.board.x, k),
        THREE.MathUtils.lerp(1.15, 1.85, k) + Math.sin(Math.PI * t.t) * 1.1,
        THREE.MathUtils.lerp(d.z - 0.18, L.board.z + 0.1, k),
      );
      m.rotation.set(t.t * 5, t.t * 3, 0);
      m.scale.setScalar(1 - Math.max(0, t.t - 0.8) * 4);
    });
  });
  return (
    <>
      {Array.from({ length: MAX_TICKETS }, (_, i) => (
        <mesh key={i} ref={(m) => { refs.current[i] = m; }} visible={false}>
          <boxGeometry args={[0.24, 0.02, 0.32]} />
          <meshStandardMaterial color="#f4f4f2" />
        </mesh>
      ))}
    </>
  );
}

/* ───────────── Packing, belts, packages, dock ───────────── */

export const PackingTables = memo(function PackingTables({ L }: { L: Layout }) {
  return (
    <group>
      {L.tables.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          <Box size={[1.1, 0.08, 1.7]} position={[0, 0.88, 0]} color="#bfa07c" />
          <Box size={[1, 0.84, 0.08]} position={[0, 0.42, -0.75]} color={PALETTE.board} />
          <Box size={[1, 0.84, 0.08]} position={[0, 0.42, 0.75]} color={PALETTE.board} />
          <Box size={[0.4, 0.3, 0.35]} position={[0.15, 1.07, -0.5]} color={PALETTE.cardboard} />
          <Box size={[0.3, 0.22, 0.3]} position={[0.2, 1.38, -0.5]} color={PALETTE.cardboard2} />
          <Box size={[L.beltX - t.x - 0.4, 0.06, 0.6]} position={[(L.beltX - t.x) / 2, 0.86, 0]} color="#7f8594" />
        </group>
      ))}
    </group>
  );
});

const SLAT = 0.35;

export function Belts({ sim, L }: { sim: SimRef; L: Layout }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const lenA = L.dockZ - L.beltZ0;
  const bTo = L.doorX + 0.8;
  const lenB = bTo - L.beltX;
  const nA = Math.floor(lenA / SLAT);
  const nB = Math.floor(lenB / SLAT);
  useFrame(() => {
    const off = (sim.current?.belt ?? 0) % SLAT;
    a.current?.children.forEach((c, i) => (c.position.z = L.beltZ0 + ((i * SLAT + off) % lenA)));
    b.current?.children.forEach((c, i) => (c.position.x = L.beltX + ((i * SLAT + off) % lenB)));
  });
  const midA = (L.beltZ0 + L.dockZ) / 2;
  return (
    <group>
      <Box size={[0.8, 0.7, lenA + 0.4]} position={[L.beltX, 0.35, midA]} color={PALETTE.dark} />
      <Box size={[lenB, 0.7, 0.8]} position={[(L.beltX + bTo) / 2, 0.35, L.dockZ]} color={PALETTE.dark} />
      <Box size={[0.7, 0.04, lenA + 0.3]} position={[L.beltX, 0.72, midA]} color={PALETTE.belt} shadow={false} />
      <Box size={[lenB, 0.04, 0.7]} position={[(L.beltX + bTo) / 2, 0.72, L.dockZ]} color={PALETTE.belt} shadow={false} />
      <group ref={a}>
        {Array.from({ length: nA }, (_, i) => (
          <mesh key={i} position={[L.beltX, 0.745, 0]}>
            <boxGeometry args={[0.66, 0.012, 0.05]} />
            <meshBasicMaterial color="#3a3f4b" />
          </mesh>
        ))}
      </group>
      <group ref={b}>
        {Array.from({ length: nB }, (_, i) => (
          <mesh key={i} position={[0, 0.745, L.dockZ]}>
            <boxGeometry args={[0.05, 0.012, 0.66]} />
            <meshBasicMaterial color="#3a3f4b" />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((sd) => (
        <Box key={sd} size={[0.06, 0.12, lenA + 0.4]} position={[L.beltX + sd * 0.42, 0.78, midA]} color="#8a8f9c" shadow={false} />
      ))}
    </group>
  );
}

export function Packages({ sim }: { sim: SimRef }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const s = sim.current;
    if (!s) return;
    s.packages.forEach((p, i) => {
      const g = refs.current[i];
      if (!g) return;
      g.visible = p.active;
      if (p.active) g.position.set(p.x, p.seg === 0 && p.wait > 0 ? 1.07 : 0.92, p.z);
    });
  });
  return (
    <>
      {Array.from({ length: MAX_PACKAGES }, (_, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g; }} visible={false}>
          <mesh castShadow>
            <boxGeometry args={[0.38, 0.3, 0.38]} />
            <meshStandardMaterial color={PALETTE.cardboard} flatShading />
          </mesh>
          <mesh position={[0, 0.152, 0]}>
            <boxGeometry args={[0.1, 0.01, 0.39]} />
            <meshStandardMaterial color={PALETTE.tape} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Pallets of 3 × 2 × 3 packages in two rows of four next to the dock. */
const PALLETS = 8;
const PER_PALLET = 18;
export const PILE_MAX = PALLETS * PER_PALLET;

function palletAt(L: Layout, p: number): [number, number] {
  return [L.doorX - 0.9 - (p % 4) * 1.3, L.dockZ + 0.95 + Math.floor(p / 4) * 1.0];
}

/**
 * Packages waiting at the dock since the last pickup (cleared when the van leaves). The pallets
 * fill one at a time, so the pile grows in step with the packed orders.
 */
export function DockPile({ sim, L }: { sim: SimRef; L: Layout }) {
  const boxes = useRef<THREE.InstancedMesh>(null);
  const pallets = useRef<(THREE.Mesh | null)[]>([]);
  useEffect(() => {
    const m = boxes.current!;
    const o = new THREE.Object3D();
    const c1 = new THREE.Color(PALETTE.cardboard);
    const c2 = new THREE.Color(PALETTE.cardboard2);
    for (let i = 0; i < PILE_MAX; i++) {
      const pal = Math.floor(i / PER_PALLET);
      const j = i % PER_PALLET;
      const layer = Math.floor(j / 6);
      const k = j % 6;
      const [px, pz] = palletAt(L, pal);
      o.position.set(px + ((k % 3) - 1) * 0.4, 0.29 + layer * 0.31, pz + (Math.floor(k / 3) - 0.5) * 0.4);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, i % 3 ? c1 : c2);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [L]);
  useFrame(() => {
    const n = Math.min(PILE_MAX, sim.current ? pileCount(sim.current) : 0);
    if (boxes.current) boxes.current.count = n;
    pallets.current.forEach((m, i) => m && (m.visible = n > i * PER_PALLET));
  });
  return (
    <>
      {/* Painted staging area */}
      <mesh rotation-x={-Math.PI / 2} position={[L.doorX - 0.9 - 1.5 * 1.3, 0.012, L.dockZ + 1.45]} receiveShadow>
        <planeGeometry args={[5.4, 2.2]} />
        <meshStandardMaterial color="#3a3f4c" />
      </mesh>
      {Array.from({ length: PALLETS }, (_, i) => {
        const [x, z] = palletAt(L, i);
        return (
          <mesh key={i} ref={(m) => { pallets.current[i] = m; }} position={[x, 0.06, z]} visible={false} receiveShadow>
            <boxGeometry args={[1.24, 0.12, 0.84]} />
            <meshStandardMaterial color="#8a6a45" flatShading />
          </mesh>
        );
      })}
      <instancedMesh ref={boxes} args={[undefined, undefined, PILE_MAX]} castShadow>
        <boxGeometry args={[0.38, 0.3, 0.38]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
    </>
  );
}

/* ───────────── Van ───────────── */

/** Van position along its route: 0 = parked at the dock, 1 = out of sight. */
export function Van({ L, u, sign }: { L: Layout; u: number; sign: THREE.Texture | null }) {
  const ref = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Group>(null);
  const uRef = useRef(u);
  uRef.current = u;
  const curve = useMemo(
    () =>
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(L.vanPark.x, 0, L.vanPark.z),
        new THREE.Vector3(L.vanPark.x + 4, 0, L.vanPark.z),
        new THREE.Vector3(L.vanPark.x + 4, 0, L.vanPark.z + 4),
        new THREE.Vector3(L.vanPark.x + 4, 0, L.vanPark.z + 24),
      ),
    [L],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const lastU = useRef(0);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const k = uRef.current;
    curve.getPoint(k, tmp);
    g.position.copy(tmp);
    curve.getTangent(Math.min(0.999, Math.max(0.001, k)), tmp);
    g.rotation.y = k < 0.002 ? 0 : Math.atan2(-tmp.z, tmp.x);
    const moved = Math.abs(k - lastU.current);
    lastU.current = k;
    wheels.current?.children.forEach((w) => (w.rotation.y += moved * 60));
  });
  return (
    <group ref={ref}>
      <Box size={[2.6, 1.7, 1.6]} position={[0.3, 1.2, 0]} color="#e9eaee" />
      <Box size={[2.62, 0.2, 1.62]} position={[0.3, 0.72, 0]} color="#5f8dd3" />
      <Box size={[1.1, 1.25, 1.55]} position={[2.15, 0.98, 0]} color="#5f8dd3" />
      <Box size={[0.05, 0.5, 1.3]} position={[2.71, 1.25, 0]} color="#1b1e25" />
      {sign && [1, -1].map((side) => (
        <mesh key={side} position={[0.3, 1.32, side * 0.811]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[2.4, 0.9]} />
          <meshBasicMaterial map={sign} transparent toneMapped={false} />
        </mesh>
      ))}
      <group ref={wheels}>
        {[[-0.6, 0.8], [-0.6, -0.8], [2.1, 0.8], [2.1, -0.8]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.32, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.22, 8]} />
            <meshStandardMaterial color="#15171c" flatShading />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ───────────── Busy-period lamps ───────────── */

export function BusyLamps({ L, level }: { L: Layout; level: number }) {
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const pos: V3[] = useMemo(() => {
    const z = L.floor.z0 + 0.05;
    return [L.storageW * 0.25, L.storageW * 0.75, L.tables[0].x].map((x): V3 => [x, 3.25, z]);
  }, [L]);
  useFrame((state) => {
    const pulse = level > 0 ? (Math.sin(state.clock.elapsedTime * 5) + 1) / 2 : 0;
    mats.current.forEach((m) => m && (m.emissiveIntensity = 0.1 + pulse * 1.6 * level));
    lights.current.forEach((l) => l && (l.intensity = pulse * 8 * level));
  });
  return (
    <>
      {pos.map((p, i) => (
        <group key={i} position={p}>
          <Box size={[0.3, 0.1, 0.3]} position={[0, -0.12, 0]} color={PALETTE.dark} />
          <mesh>
            <sphereGeometry args={[0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial ref={(m) => { mats.current[i] = m; }} color="#d9822b" emissive="#d96a1b" emissiveIntensity={0.1} />
          </mesh>
          <pointLight ref={(l) => { lights.current[i] = l; }} color="#e08a3c" intensity={0} distance={9} />
        </group>
      ))}
    </>
  );
}
