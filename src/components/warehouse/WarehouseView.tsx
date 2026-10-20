import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { HOUR, floorHour, ordersAt, standingsAt, valueAt, type RaceData, type Standing } from '../../lib/race';
import { fmtClock, fmtInt, hueFor } from '../../lib/format';
import { shuffleNames } from '../../lib/staff';
import { isOpen, pickupAllowed, type OpenHours } from '../../lib/hours';
import { packedAt, packingRate, planPacking } from '../../lib/packing';
import { MAX_SHELVES, SHELF_H, buildLayout, type Layout } from './layout';
import { clearDock, createSim, stepSim, type Sim } from './sim';
import {
  Belts, Building, BusyLamps, DockPile, PILE_MAX, LeaderMarker, PALETTE, PackingTables, Packages, SalesColumn, SalesDesks, Shelf, Tickets, Van, WallSign, Workers,
} from './models';
import { CeilingLamps, Facade, INTRO_SEC, introPose, type Pose } from './intro';
import { COLUMN_MAX, fitPose, leaderboardWidth } from './camera';
import { useSignTexture } from './signs';

interface Props {
  data: RaceData;
  t: number;
  standings: Standing[];
  playing: boolean;
  speed: number;
  durationSec: number;
  staff: string[];
  company: string;
  logo: string | null;
  hours: OpenHours;
  /** Play the opening fly-in; the parent ends it via onIntroDone (or by skipping). */
  intro: boolean;
  onIntroDone: () => void;
  /** Increments on every seek so the illustrative floor starts fresh. */
  seek: number;
  /** Full screen / video: the clock and numbers are drawn over the top of the scene. */
  hud?: boolean;
}

interface ShelfSlot {
  productIds: number[];
  label: string;
  color: string;
}

// Comma syntax: three.js does not parse space-separated hsl()
const hsl = (name: string) => `hsl(${hueFor(name)}, 45%, 55%)`;
const PICKUP_STEPS_H = [1, 2, 3, 4, 6, 8, 12, 24];
const MIN_PICKUP_REAL_MS = 4500;

/**
 * One shelf per product. Products that ever lead get a shelf first so the leader marker always
 * sits on a named shelf; above MAX_SHELVES the last shelf collects the rest.
 */
function assignShelves(data: RaceData): { slots: ShelfSlot[]; shelfOf: number[] } {
  const n = data.products.length;
  const units = (id: number) => data.products[id].units;
  const leaders = new Set<number>();
  const first = data.events.find((e) => e.kind === 'first');
  if (first) leaders.add(standingsAt(data, first.time)[0].productId);
  for (const e of data.events) if (e.kind === 'lead') leaders.add(e.productId);

  const own = n <= MAX_SHELVES ? n : MAX_SHELVES - 1;
  const ranked = [...data.products.keys()].sort((a, b) => units(b) - units(a));
  const picked = [...[...leaders].sort((a, b) => units(b) - units(a)), ...ranked.filter((id) => !leaders.has(id))]
    .slice(0, own)
    .sort((a, b) => units(b) - units(a));

  const slots: ShelfSlot[] = picked.map((id) => ({ productIds: [id], label: data.products[id].name, color: hsl(data.products[id].name) }));
  const shelfOf = new Array(n).fill(-1);
  picked.forEach((id, i) => (shelfOf[id] = i));
  if (n > own) {
    const rest = ranked.filter((id) => shelfOf[id] < 0);
    rest.forEach((id) => (shelfOf[id] = own));
    slots.push({ productIds: rest, label: `Øvrige varer (${rest.length})`, color: '#8a8f9c' });
  }
  return { slots, shelfOf };
}

/**
 * Van pickups on fixed clock times within opening hours, spaced so each trip is visible at 1× speed.
 * A package stands for a fixed number of orders, chosen so the largest load between two pickups
 * fits on the dock pallets.
 */
function pickupSchedule(data: RaceData, durationSec: number, open: OpenHours, packed: number[]) {
  const span = data.end - data.start;
  const realMsPerHour = (durationSec * 1000 * HOUR) / span;
  const hours = PICKUP_STEPS_H.find((h) => h * realMsPerHour >= MIN_PICKUP_REAL_MS) ?? 24;
  const times: number[] = [];
  const day = new Date(data.start);
  day.setHours(0, 0, 0, 0);
  // A daily pickup happens at closing time
  const offset = hours === 24 && open[1] - open[0] < 24 ? open[1] - 24 : 0;
  for (let k = 1; ; k++) {
    const b = new Date(day);
    b.setHours(offset + k * hours);
    const bt = b.getTime();
    if (bt > data.end) break;
    if (bt > data.start && pickupAllowed(open, bt)) times.push(bt);
  }
  let maxLoad = 0;
  [data.start, ...times, data.end].reduce((a, b) => {
    maxLoad = Math.max(maxLoad, packedAt(packed, b) - packedAt(packed, a));
    return b;
  });
  const ordersPerPackage = Math.max(1, Math.ceil(maxLoad / PILE_MAX));
  return { hours, times, ordersPerPackage };
}

/** Height of the full-screen clock and number panels (see .player.full in styles.css). */
const HUD_TOP = 150;

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export default function WarehouseView({ data, t, standings, playing, speed, durationSec, staff, company, logo, hours, intro, onIntroDone, seek, hud = false }: Props) {
  const { slots, shelfOf } = useMemo(() => assignShelves(data), [data]);
  const L = useMemo(
    () => buildLayout({ shelfCount: slots.length, peakOrders: data.busiest?.orders ?? 1, staffCount: staff.length }),
    [slots.length, data.busiest, staff.length],
  );
  const open = isOpen(hours, t);
  // Names are spread randomly over the figures; they do not reflect who actually picked what.
  // Larger teams than the floor holds take turns, so every name gets time on the floor.
  const shuffled = useMemo(() => shuffleNames(staff, data.start), [staff, data.start]);
  const shifts = Math.max(1, Math.ceil(shuffled.length / L.maxWorkers));
  const shift = Math.min(shifts - 1, Math.floor(((t - data.start) / (data.end - data.start)) * shifts));
  const names = shuffled.length ? Array.from({ length: L.maxWorkers }, (_, i) => shuffled[(shift * L.maxWorkers + i) % shuffled.length]) : [];
  const nameEls = useRef<(HTMLDivElement | null)[]>([]);
  // When each real order is packed (night orders wait for the morning; counts stay exact)
  const rate = packingRate(data.busiest?.orders ?? 1);
  const packed = useMemo(() => planPacking(data.orderTimes, hours, rate), [data.orderTimes, hours, rate]);
  const schedule = useMemo(() => pickupSchedule(data, durationSec, hours, packed), [data, durationSec, hours, packed]);
  const sim = useRef<Sim>(createSim(L, open));
  const simLayout = useRef(L);
  if (simLayout.current !== L) {
    simLayout.current = L;
    sim.current = createSim(L, open);
  }
  const vanSign = useSignTexture(company, logo, { w: 960, h: 360, bg: null, fg: '#20242c', weight: 800 });
  const introClock = useRef({ t: 0, active: intro });
  introClock.current.active = intro;

  // Exact numbers at the playhead
  const units = slots.map((s) => s.productIds.reduce((a, id) => a + valueAt(data.series[id], t), 0));
  const leader = standings[0]?.units ? standings[0].productId : -1;
  const leaderShelf = leader >= 0 ? shelfOf[leader] : -1;
  const maxUnits = Math.max(1, ...units);

  // Busy level from the real hourly order counts
  const hourStart = floorHour(t);
  const bucket = data.hourly.find((h) => h.start === hourStart);
  const level = data.busiest && bucket ? bucket.orders / data.busiest.orders : 0;
  const busy = level >= 0.7;
  const isBusiest = data.busiest !== null && data.busiest.start === hourStart && t < data.end;
  const ordersThisHour = ordersAt(data, t) - ordersAt(data, Math.max(data.start, hourStart) - 1);

  // Pickups: exact counts of packed orders between fixed clock times
  let lastIdx = -1;
  while (lastIdx + 1 < schedule.times.length && schedule.times[lastIdx + 1] <= t) lastIdx++;
  const lastPickup = lastIdx >= 0 ? schedule.times[lastIdx] : null;
  const nextPickup = schedule.times[lastIdx + 1] ?? null;
  const pickedUp = lastPickup !== null
    ? packedAt(packed, lastPickup) - (lastIdx > 0 ? packedAt(packed, schedule.times[lastIdx - 1]) : 0)
    : 0;
  const ready = packedAt(packed, t) - (lastPickup !== null ? packedAt(packed, lastPickup) : 0);
  const waiting = ordersAt(data, t) - packedAt(packed, t);
  const away = schedule.hours * HOUR * 0.5;
  // The van only drives when there was something to collect
  const vanS = lastPickup !== null && pickedUp > 0 ? (t - lastPickup) / away : 1;
  const vanU = vanS < 1 ? (vanS < 0.5 ? ease(vanS * 2) : ease((1 - vanS) * 2)) : 0;

  const colors = slots.map((s) => s.color);
  const live = useRef({ t, playing, speed, lastPickup, open, seek });
  live.current = { t, playing, speed, lastPickup, open, seek };

  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const anchors = useRef<[number, number, number][]>([]);
  anchors.current = [
    ...slots.map((_, i): [number, number, number] => [
      L.shelves[i].x,
      SHELF_H + (units[i] / maxUnits) * COLUMN_MAX + (i === leaderShelf ? 0.95 : 0.25),
      L.shelves[i].z,
    ]),
    ...L.zones.map((z) => z.at),
    [L.vanPark.x + 0.3, 3.4, L.dockZ],
  ];

  return (
    <div className={`warehouse ${intro ? "intro" : ""}`}>
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 40, position: [0, 30, 20] }} gl={{ antialias: true }}>
        <color attach="background" args={[PALETTE.background]} />
        <Lights L={L} night={!open} />

        <SimDriver
          sim={sim}
          L={L}
          live={live}
          data={data}
          shelfOf={shelfOf}
          packed={packed}
          ordersPerPackage={schedule.ordersPerPackage}
        />

        <Building L={L} />
        {company && <WallSign L={L} company={company} logo={logo} />}
        {intro && <Facade L={L} company={company} logo={logo} clock={introClock} />}
        {intro && <CeilingLamps L={L} clock={introClock} />}
        {slots.map((s, i) => (
          <Shelf key={i} s={L.shelves[i]} index={i} color={s.color} />
        ))}
        {slots.map((s, i) => (
          <SalesColumn key={i} s={L.shelves[i]} color={s.color} height={(units[i] / maxUnits) * COLUMN_MAX} leader={i === leaderShelf} />
        ))}
        {leaderShelf >= 0 && <LeaderMarker s={L.shelves[leaderShelf]} height={(units[leaderShelf] / maxUnits) * COLUMN_MAX} />}
        <SalesDesks sim={sim} L={L} />
        <Tickets sim={sim} L={L} />
        <PackingTables L={L} />
        <Belts sim={sim} L={L} />
        <Packages sim={sim} />
        <DockPile sim={sim} L={L} />
        <Workers sim={sim} count={L.maxWorkers} colors={colors} />
        <Van L={L} u={vanU} sign={company ? vanSign : null} />
        <BusyLamps L={L} level={busy ? Math.min(1, level) : 0} />

        <LabelProjector anchors={anchors} els={labelEls} shelves={slots.length} />
        {names.length > 0 && <NameProjector sim={sim} els={nameEls} intro={introClock} />}
        <CameraRig L={L} intro={introClock} onIntroDone={onIntroDone} sign={!!company} hud={hud} />
      </Canvas>

      {/* DOM labels positioned each frame by LabelProjector */}
      <div className="wh-labels">
        {slots.map((s, i) => (
          <div key={i} ref={(el) => { labelEls.current[i] = el; }} className="wh-anchor">
            <div className={`shelf-label ${i === leaderShelf ? 'lead' : ''}`} style={{ borderBottomColor: s.color }} title={s.label}>
              <span className="sl-units">{fmtInt(units[i])}</span>
            </div>
          </div>
        ))}
        {L.zones.map((z, i) => (
          <div key={z.text} ref={(el) => { labelEls.current[slots.length + i] = el; }} className="wh-anchor zone">
            <span className="zone-label">{z.text}</span>
          </div>
        ))}
        {names.map((n, i) => (
          <div key={i} ref={(el) => { nameEls.current[i] = el; }} className="wh-anchor" style={{ visibility: 'hidden' }}>
            <span className="worker-name">{n}</span>
          </div>
        ))}
        <div ref={(el) => { labelEls.current[slots.length + L.zones.length] = el; }} className="wh-anchor dock">
          <div className="dock-label">
            {vanS < 1 && lastPickup !== null && pickedUp > 0 && ready === 0 ? (
              <>Afhentet kl. {fmtClock(lastPickup)} · <b>{fmtInt(pickedUp)}</b> ordrer</>
            ) : (
              <>
                <b>{fmtInt(ready)}</b> pakket{nextPickup !== null && <> · afhentes kl. {fmtClock(nextPickup)}</>}
              </>
            )}
            {waiting > 0 && <div className="dock-wait"><b>{fmtInt(waiting)}</b> venter på pakning</div>}
          </div>
        </div>
      </div>

      <Leaderboard data={data} standings={standings} />

      <div className="wh-overlay">
        {busy && open && (
          <span className="wh-busy">
            {isBusiest ? 'Periodens travleste time' : 'Travl periode'} · {fmtInt(ordersThisHour)} ordrer siden kl. {fmtClock(hourStart)}
          </span>
        )}
      </div>
      <p className="wh-note">
        Illustreret lagerforløb baseret på salgsdata · afhentning {schedule.hours === 24 ? `dagligt kl. ${String(hours[1] - hours[0] >= 24 ? 0 : hours[1] % 24).padStart(2, '0')}.00` : schedule.hours === 1 ? 'hver time' : `hver ${schedule.hours}. time`}
        {' '}· pakketempo ca. {fmtInt(rate)} ordrer/time
        {schedule.ordersPerPackage > 1 && <> · 1 pakke = {schedule.ordersPerPackage} ordrer</>}
        {names.length > 0 && <> · navne er fordelt tilfældigt{shifts > 1 && <>, {L.maxWorkers} ad gangen</>}</>}
      </p>
    </div>
  );
}

/** Fixed top-5 list; rows slide to their new place when the order changes. */
function Leaderboard({ data, standings }: { data: RaceData; standings: Standing[] }) {
  const top = standings.filter((s) => s.units > 0).slice(0, 5);
  // Keep DOM order stable (by product), so overtakes only move rows via transform.
  // Reordering the nodes would restart their fade-in and break the slide.
  const rows = top.map((s, rank) => ({ s, rank })).sort((a, b) => a.s.productId - b.s.productId);
  return (
    <div className="leaderboard">
      <h4>Mest solgte</h4>
      <ol style={{ height: `calc(${Math.max(1, top.length)} * (var(--row) + 6px) - 6px)` }}>
        {rows.map(({ s, rank }) => {
          const name = data.products[s.productId].name;
          return (
            <li key={s.productId} style={{ transform: `translateY(calc(${rank} * (100% + 6px)))` }}>
              <span className="lb-rank">{rank + 1}</span>
              <span className="lb-swatch" style={{ background: hsl(name) }} />
              <span className="lb-name">{name}</span>
              <span className="lb-units">{fmtInt(s.units)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Daylight while open; dimmed night light when the warehouse is closed. */
function Lights({ L, night }: { L: Layout; night: boolean }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  useFrame((_, dt) => {
    // Night stays readable on a projector: at most ~35 % darker, plus warm work lights
    if (hemi.current) hemi.current.intensity = THREE.MathUtils.damp(hemi.current.intensity, night ? 1.0 : 1.5, 2, dt);
    if (sun.current) sun.current.intensity = THREE.MathUtils.damp(sun.current.intensity, night ? 1.25 : 2, 2, dt);
    spots.current.forEach((l) => l && (l.intensity = THREE.MathUtils.damp(l.intensity, night ? 9 : 0, 2, dt)));
  });
  const spots = useRef<(THREE.PointLight | null)[]>([]);
  const spotPos: [number, number, number][] = [
    [L.storageW * 0.2, 4.2, L.aisleZ[0]],
    [L.storageW * 0.75, 4.2, L.aisleZ[L.aisleZ.length - 1]],
    [L.tables[0].x, 4.2, (L.tables[0].z + L.dockZ) / 2],
  ];
  return (
    <>
      <hemisphereLight ref={hemi} args={['#dfe3ec', '#3a3d46', night ? 1.0 : 1.5]} />
      <ShadowLight L={L} light={sun} />
      {spotPos.map((p, i) => (
        <pointLight key={i} ref={(l) => { spots.current[i] = l; }} position={p} color="#ffb347" intensity={0} distance={11} decay={1.4} />
      ))}
    </>
  );
}

function ShadowLight({ L, light }: { L: Layout; light: React.RefObject<THREE.DirectionalLight | null> }) {
  const { x0, x1, z0, z1 } = L.floor;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const r = Math.max(x1 - x0, z1 - z0) * 0.75 + 6;
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
  }, [cx, cz, light]);
  return (
    <directionalLight
      ref={light}
      position={[cx + 10, 22, cz + 9]}
      intensity={2}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-r}
      shadow-camera-right={r}
      shadow-camera-top={r}
      shadow-camera-bottom={-r}
      shadow-camera-far={80}
      shadow-bias={-0.0005}
    />
  );
}

/**
 * Frames the whole floor (plus the yard) whenever the layout or canvas size changes. During the
 * intro the camera follows the fly-in path instead and orbit controls are off.
 */
function CameraRig({ L, intro, onIntroDone, sign, hud }: {
  L: Layout;
  /** Keep the top of the canvas free for the full-screen clock and numbers. */
  hud: boolean;
  /** Leave room for the company sign above the back wall. */
  sign: boolean;
  intro: React.RefObject<{ t: number; active: boolean }>;
  onIntroDone: () => void;
}) {
  const { camera, size } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const fit = useMemo(
    () => fitPose(L, sign, size.width / size.height, (camera as THREE.PerspectiveCamera).fov, leaderboardWidth(size.width) / size.width, hud ? HUD_TOP / size.height : 0),
    [L, camera, size.width, size.height, sign, hud],
  );

  const introActive = intro.current!.active;
  useEffect(() => {
    if (introActive) return;
    const { pos, look } = fit.pose;
    camera.position.copy(pos);
    camera.lookAt(look);
    controls.current?.target.copy(look);
    controls.current?.update();
  }, [fit, camera, introActive]);

  const pose = useMemo<Pose>(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const done = useRef(false);
  useFrame((_, dt) => {
    const c = intro.current!;
    if (!c.active) return;
    c.t = Math.min(INTRO_SEC, c.t + Math.min(dt, 0.05));
    introPose(L, c.t, fit.pose, pose);
    camera.position.copy(pose.pos);
    camera.lookAt(pose.look);
    if (c.t >= INTRO_SEC && !done.current) {
      done.current = true;
      onIntroDone();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={!introActive}
      enablePan={false}
      enableDamping
      minDistance={fit.d * 0.4}
      maxDistance={fit.d * 1.5}
      minPolarAngle={0.2}
      maxPolarAngle={1.2}
    />
  );
}

/** Projects 3D anchor points to screen space and moves the DOM labels there every frame. */
function LabelProjector({ anchors, els, shelves }: {
  anchors: React.RefObject<[number, number, number][]>;
  els: React.RefObject<(HTMLDivElement | null)[]>;
  /** The first `shelves` anchors are shelf labels; they are pushed apart so none overlap. */
  shelves: number;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const placed: { x: number; y: number; w: number; h: number; i: number }[] = [];
    anchors.current!.forEach((a, i) => {
      const el = els.current![i];
      if (!el) return;
      v.set(a[0], a[1], a[2]).project(camera);
      const hidden = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.visibility = hidden ? 'hidden' : 'visible';
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.zIndex = String(Math.round((1 - v.z) * 10000));
      if (i < shelves) {
        const box = el.firstElementChild as HTMLElement;
        placed.push({ x, y, w: box.offsetWidth, h: box.offsetHeight, i });
      } else el.style.transform = `translate(${x}px, ${y}px)`;
    });
    // Labels hang from their bottom centre: settle them bottom-up, lifting any that would overlap
    placed.sort((p, q) => q.y - p.y);
    for (let k = 0; k < placed.length; k++) {
      const p = placed[k];
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j < k; j++) {
          const q = placed[j];
          if (Math.abs(p.x - q.x) < (p.w + q.w) / 2 + 4 && p.y > q.y - q.h - 4 && p.y - p.h < q.y + 4) p.y = q.y - q.h - 4;
        }
      }
      els.current![p.i]!.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  });
  return null;
}

/** Keeps each name tag above its (moving) figure. */
function NameProjector({ sim, els, intro }: {
  sim: React.RefObject<Sim>;
  els: React.RefObject<(HTMLDivElement | null)[]>;
  intro: React.RefObject<{ active: boolean }>;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    sim.current?.workers.forEach((w, i) => {
      const el = els.current![i];
      if (!el) return;
      v.set(w.x, 2.05, w.z).project(camera);
      el.style.visibility = v.z > 1 || w.vis < 0.6 || intro.current!.active ? 'hidden' : 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 10000));
    });
  });
  return null;
}

/** Feeds exact per-shelf unit and order deltas from the sales data into the illustrative simulation. */
function SimDriver({ sim, L, live, data, shelfOf, packed, ordersPerPackage }: {
  sim: React.RefObject<Sim>;
  L: Layout;
  live: React.RefObject<{ t: number; playing: boolean; speed: number; lastPickup: number | null; open: boolean; seek: number }>;
  data: RaceData;
  shelfOf: number[];
  packed: number[];
  ordersPerPackage: number;
}) {
  // Packages at the dock: everything packed since the last pickup
  const boxes = (at: number, lastPickup: number | null) =>
    Math.ceil((packedAt(packed, at) - (lastPickup !== null ? packedAt(packed, lastPickup) : 0)) / ordersPerPackage);
  const prevT = useRef<number | null>(null);
  const prevPickup = useRef<number | null>(null);
  const prevSeek = useRef(live.current!.seek);
  useFrame((_, delta) => {
    const { t, playing, speed, lastPickup, open, seek } = live.current!;
    const prev = prevT.current;
    prevT.current = t;
    // Seeking or restarting: start the floor fresh instead of replaying everything at once,
    // with the dock already holding what was packed since the last pickup
    if (seek !== prevSeek.current || prev === null || t < prev || t - prev > (data.end - data.start) * 0.05) {
      prevSeek.current = seek;
      if (prev !== null) sim.current = createSim(L, open, L.maxWorkers);
      sim.current!.pileTarget = boxes(t, lastPickup);
      prevPickup.current = lastPickup;
      return;
    }
    const s = sim.current!;
    let newPackages = 0;
    if (lastPickup !== prevPickup.current) {
      prevPickup.current = lastPickup;
      clearDock(s); // the van took everything at the dock
    } else newPackages = Math.max(0, boxes(t, lastPickup) - boxes(prev, lastPickup));
    const newOrders = ordersAt(data, t) - ordersAt(data, prev);
    const packedNow = packedAt(packed, t) - packedAt(packed, prev);
    const unpacked = ordersAt(data, prev) - packedAt(packed, prev) + newOrders;
    const deltas = new Array(L.shelves.length).fill(0);
    if (t > prev) {
      data.series.forEach((series, id) => {
        const d = valueAt(series, t) - valueAt(series, prev);
        if (d > 0 && shelfOf[id] >= 0) deltas[shelfOf[id]] += d;
      });
    }
    stepSim(s, L, {
      dt: playing ? Math.min(delta, 0.1) * speed : 0,
      unitDeltas: deltas,
      newOrders,
      release: unpacked > 0 ? Math.min(1, packedNow / unpacked) : 0,
      newPackages,
      pileTarget: boxes(t, lastPickup),
      open,
    });
  });
  return null;
}
