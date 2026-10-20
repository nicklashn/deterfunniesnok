/**
 * Illustrative floor simulation. It is fed exact unit and order deltas from the sales data,
 * but who walks where and how picks are batched is only a visualisation. Nothing here feeds
 * back into any number shown on screen.
 */
import type { Layout, P } from './layout';

export const MAX_PACKAGES = 80;
export const MAX_TICKETS = 24;
export const BELT_SPEED = 2.6;
const WALK_SPEED = 2.5;
/** Strolling pace for idle staff tidying shelves. */
const STROLL_SPEED = 1.1;
const PICK_SEC = 0.6;
const DROP_SEC = 0.5;

type Task = 'idle' | 'toShelf' | 'picking' | 'toPack' | 'dropping' | 'toDispatch' | 'home';

export interface Worker {
  id: number;
  x: number;
  z: number;
  heading: number;
  path: P[];
  task: Task;
  timer: number;
  shelf: number;
  carry: number;
  walk: number;
  /** 0 = gone home, 1 = on the floor; animated so people fade out at closing and in at opening. */
  vis: number;
  /** Walking without a job (slower). */
  stroll: boolean;
}

export interface Pkg {
  active: boolean;
  path: P[];
  seg: number;
  x: number;
  z: number;
  wait: number;
}

export interface Ticket {
  active: boolean;
  desk: number;
  t: number;
}

export interface Sim {
  workers: Worker[];
  /** Units sold but not yet released for picking (their orders are still waiting to be packed). */
  held: number[];
  /** Units released for picking. */
  pending: number[];
  packages: Pkg[];
  tickets: Ticket[];
  nextTable: number;
  /** Packages at the dock right now (from the packing timeline). */
  pileTarget: number;
  ticketCooldown: number;
  deskFlash: number[];
  nextDesk: number;
  belt: number;
}

/**
 * Fresh floor. When the warehouse is open everyone is at work (after a seek, `spread` of them start
 * in the aisles so the scene is alive at once); when it is closed everyone has gone home.
 */
export function createSim(L: Layout, open: boolean, spread = 0): Sim {
  return {
    workers: Array.from({ length: L.maxWorkers }, (_, id) => {
      const inAisle = open && id < spread;
      const p = inAisle ? { x: L.shelves[(id * 5) % L.shelves.length].x, z: L.aisleZ[id % L.aisleZ.length] } : L.dispatch(id);
      const task: Task = open ? 'idle' : 'home';
      return { id, x: p.x, z: p.z, heading: 0, path: [], task, timer: open ? Math.random() * 3 : 0, shelf: -1, carry: 0, walk: 0, vis: open ? 1 : 0, stroll: false };
    }),
    held: new Array(L.shelves.length).fill(0),
    pending: new Array(L.shelves.length).fill(0),
    packages: Array.from({ length: MAX_PACKAGES }, () => ({ active: false, path: [], seg: 0, x: 0, z: 0, wait: 0 })),
    tickets: Array.from({ length: MAX_TICKETS }, () => ({ active: false, desk: 0, t: 0 })),
    nextTable: 0,
    pileTarget: 0,
    ticketCooldown: 0,
    deskFlash: new Array(L.desks.length).fill(0),
    nextDesk: 0,
    belt: 0,
  };
}

/* ── Routing over the corridor/aisle grid ── */

type Zone = { kind: 'west' } | { kind: 'east' } | { kind: 'aisle'; a: number };

function nearestAisle(L: Layout, z: number): number {
  let best = 0;
  L.aisleZ.forEach((az, i) => {
    if (Math.abs(az - z) < Math.abs(L.aisleZ[best] - z)) best = i;
  });
  return best;
}

function zoneOf(L: Layout, p: P): Zone {
  if (p.x <= L.corridorW + 0.3) return { kind: 'west' };
  if (p.x >= L.corridorE - 0.3) return { kind: 'east' };
  return { kind: 'aisle', a: nearestAisle(L, p.z) };
}

/** Path from p onto the centre line of aisle a at x. */
function intoAisle(L: Layout, p: P, a: number, x: number): P[] {
  const az = L.aisleZ[a];
  const z = zoneOf(L, p);
  if (z.kind === 'aisle') {
    if (z.a === a) return [{ x: p.x, z: az }, { x, z: az }];
    const c = Math.abs(p.x - L.corridorW) < Math.abs(p.x - L.corridorE) ? L.corridorW : L.corridorE;
    const bz = L.aisleZ[z.a];
    return [{ x: p.x, z: bz }, { x: c, z: bz }, { x: c, z: az }, { x, z: az }];
  }
  const c = z.kind === 'west' ? L.corridorW : L.corridorE;
  return [{ x: c, z: p.z }, { x: c, z: az }, { x, z: az }];
}

/** Path from p to a point in the west (dispatch, rest) or east (packing) zone. */
function toSide(L: Layout, p: P, side: 'west' | 'east', dest: P): P[] {
  const z = zoneOf(L, p);
  const c = side === 'west' ? L.corridorW : L.corridorE;
  if (z.kind === side) return [{ x: c, z: p.z }, { x: c, z: dest.z }, dest];
  if (z.kind === 'aisle') {
    const az = L.aisleZ[z.a];
    return [{ x: p.x, z: az }, { x: c, z: az }, { x: c, z: dest.z }, dest];
  }
  // Crossing from one side to the other through the nearest aisle
  const a = nearestAisle(L, p.z);
  const other = side === 'west' ? L.corridorE : L.corridorW;
  return [{ x: other, z: p.z }, { x: other, z: L.aisleZ[a] }, { x: c, z: L.aisleZ[a] }, { x: c, z: dest.z }, dest];
}

// Small per-worker lane offset so people don't walk inside each other
const lane = (w: Worker, p: P): P => ({ x: p.x + ((w.id % 3) - 1) * 0.12, z: p.z + ((w.id % 4) - 1.5) * 0.2 });

function goTo(w: Worker, pts: P[], task: Task, stroll = false) {
  w.path = pts.map((p, i) => (i === pts.length - 1 ? p : lane(w, p)));
  w.task = task;
  w.stroll = stroll;
}

/* ── Step ── */

export interface StepInput {
  dt: number;
  /** Exact units sold per shelf since the last step. */
  unitDeltas: number[];
  newOrders: number;
  /** Share (0–1) of the orders waiting to be packed that were packed during this step. */
  release: number;
  /** Packages finished at the packing tables during this step (from the packing timeline). */
  newPackages: number;
  /** Packages packed since the last pickup (shown at the dock). */
  pileTarget: number;
  /** Inside opening hours: staff are on the floor and packing happens. */
  open: boolean;
}

/** At most this many packages are put on the belt per step; the rest go straight to the pile. */
const SPAWN_PER_STEP = 3;

export function stepSim(sim: Sim, L: Layout, { dt, unitDeltas, newOrders, release, newPackages, pileTarget, open }: StepInput) {
  // Units wait until their orders are being packed; then they are picked
  unitDeltas.forEach((u, i) => {
    sim.held[i] += u;
    const r = sim.held[i] * release;
    sim.held[i] -= r;
    sim.pending[i] += r;
  });
  sim.belt += BELT_SPEED * dt;

  // Order tickets fly from the sales desks to the dispatch board (rate-limited)
  sim.ticketCooldown -= dt;
  if (newOrders > 0 && sim.ticketCooldown <= 0) {
    const free = sim.tickets.find((t) => !t.active);
    if (free) {
      free.active = true;
      free.t = 0;
      free.desk = sim.nextDesk;
      sim.deskFlash[sim.nextDesk] = 1;
      sim.nextDesk = (sim.nextDesk + 1) % sim.deskFlash.length;
    }
    sim.ticketCooldown = 0.12;
  }
  for (const t of sim.tickets) if (t.active && (t.t += dt / 0.9) >= 1) t.active = false;
  sim.deskFlash = sim.deskFlash.map((f) => Math.max(0, f - dt * 2.5));

  // Packages leave the packing tables exactly as the packing timeline finishes them
  sim.pileTarget = pileTarget;
  for (let k = 0; k < Math.min(newPackages, SPAWN_PER_STEP); k++) spawnPackage(sim, L);

  for (const w of sim.workers) stepWorker(sim, L, w, dt, open);

  for (const p of sim.packages) {
    if (!p.active) continue;
    if (p.wait > 0) {
      p.wait -= dt;
      continue;
    }
    if (followPath(p, BELT_SPEED * dt)) p.active = false;
  }
}

/** The van collected everything at the dock and on the belt. */
export function clearDock(sim: Sim) {
  for (const p of sim.packages) p.active = false;
  sim.pileTarget = 0;
}

/**
 * Packages at the dock: exactly what was packed since the last pickup. Boxes on the belt only show
 * the flow; at this time scale a real belt trip would take seconds of sim time, not hours.
 */
export function pileCount(sim: Sim): number {
  return sim.pileTarget;
}

/** Moves a package along its path; returns true when the end is reached. */
function followPath(o: Pkg, dist: number): boolean {
  let move = dist;
  while (move > 0 && o.seg < o.path.length) {
    const target = o.path[o.seg];
    const dx = target.x - o.x;
    const dz = target.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d <= move) {
      o.x = target.x;
      o.z = target.z;
      o.seg++;
      move -= d;
    } else {
      o.x += (dx / d) * move;
      o.z += (dz / d) * move;
      move = 0;
    }
  }
  return o.seg >= o.path.length;
}

function spawnPackage(sim: Sim, L: Layout) {
  const p = sim.packages.find((x) => !x.active);
  if (!p) return; // pool full: purely visual
  const table = L.tables[sim.nextTable];
  sim.nextTable = (sim.nextTable + 1) % L.tables.length;
  p.active = true;
  p.path = [
    { x: L.beltX, z: table.z },
    { x: L.beltX, z: L.dockZ },
    { x: L.doorX - 0.7, z: L.dockZ },
  ];
  p.seg = 0;
  p.x = table.x;
  p.z = table.z;
  p.wait = 0.4;
}

function takeJob(sim: Sim): number {
  let best = -1;
  for (let i = 0; i < sim.pending.length; i++) if (sim.pending[i] >= 1 && (best < 0 || sim.pending[i] > sim.pending[best])) best = i;
  return best;
}

function startJob(sim: Sim, L: Layout, w: Worker, shelf: number) {
  const units = Math.floor(sim.pending[shelf]);
  // Big backlogs are split so several people share the work
  const take = units <= 3 ? units : Math.ceil(units / 2);
  sim.pending[shelf] -= take;
  w.shelf = shelf;
  w.carry = take;
  const s = L.shelves[shelf];
  goTo(w, [...intoAisle(L, w, s.aisle, s.x), s.pick], 'toShelf');
}

function stepWorker(sim: Sim, L: Layout, w: Worker, dt: number, active: boolean) {
  w.vis = Math.max(0, Math.min(1, w.vis + (w.task === 'home' && w.timer <= 0 ? -dt : dt) * 2.5));

  // Closing time: everyone leaves (staggered). Unfinished picks go back on the list for the morning.
  if (!active && w.task !== 'home') {
    if ((w.task === 'toShelf' || w.task === 'picking') && w.shelf >= 0) sim.pending[w.shelf] += w.carry;
    w.stroll = false;
    w.carry = 0;
    w.path = [];
    w.task = 'home';
    w.timer = 0.08 * (w.id % 10);
    return;
  }
  if (w.task === 'home') {
    w.timer -= dt;
    // Opening: staggered arrival somewhere on the floor
    if (active && w.vis <= 0 && w.timer <= -0.08 * (w.id % 10)) {
      const s = L.shelves[Math.floor(Math.random() * L.shelves.length)];
      w.x = s.x + (Math.random() - 0.5) * 1.6;
      w.z = L.aisleZ[s.aisle];
      w.task = 'idle';
      w.timer = 0.5 + Math.random() * 2;
    }
    return;
  }

  if (w.path.length) {
    let move = (w.stroll ? STROLL_SPEED : WALK_SPEED) * dt;
    while (move > 0 && w.path.length) {
      const target = w.path[0];
      const dx = target.x - w.x;
      const dz = target.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) w.heading = Math.atan2(dx, dz);
      if (d <= move) {
        w.x = target.x;
        w.z = target.z;
        w.path.shift();
        move -= d;
      } else {
        w.x += (dx / d) * move;
        w.z += (dz / d) * move;
        move = 0;
      }
    }
    w.walk += dt * (w.stroll ? 5 : 8);
    if (!w.path.length) arrive(L, w);
    return;
  }

  if (w.task === 'picking' || w.task === 'dropping') {
    w.timer -= dt;
    if (w.timer > 0) return;
    if (w.task === 'picking') {
      const t = L.tables[w.id % L.tables.length];
      goTo(w, toSide(L, w, 'east', t.stand), 'toPack');
    } else {
      w.carry = 0;
      const job = active ? takeJob(sim) : -1;
      if (job >= 0) startJob(sim, L, w, job);
      else goTo(w, toSide(L, w, 'west', L.dispatch(w.id)), 'toDispatch');
    }
    return;
  }

  if (w.task === 'idle') {
    const job = takeJob(sim);
    if (job >= 0) startJob(sim, L, w, job);
    else {
      // Nothing to pick: stroll to a shelf now and then to tidy it, so the team spreads over the floor
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 4 + Math.random() * 6;
        const r = Math.random();
        if (r < 0.5) {
          const s = L.shelves[Math.floor(Math.random() * L.shelves.length)];
          goTo(w, [...intoAisle(L, w, s.aisle, s.x + (Math.random() - 0.5) * 1.2)], 'toDispatch', true);
        } else if (r < 0.7) {
          goTo(w, toSide(L, w, 'west', L.dispatch(w.id)), 'toDispatch', true);
        }
      }
    }
  }
}

function arrive(L: Layout, w: Worker) {
  switch (w.task) {
    case 'toShelf':
      w.task = 'picking';
      w.timer = PICK_SEC;
      w.heading = L.shelves[w.shelf].facing > 0 ? Math.PI : 0;
      break;
    case 'toPack':
      w.task = 'dropping';
      w.timer = DROP_SEC;
      w.heading = Math.PI / 2;
      break;
    case 'toDispatch':
      w.task = 'idle';
      break;
  }
}
