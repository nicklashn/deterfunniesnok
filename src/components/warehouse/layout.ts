/**
 * Floor plan generated from the data: one shelf per product (up to MAX_SHELVES) spread over
 * as many aisles as needed, and packing tables, sales desks and staff scaled to the busiest hour.
 * World units ≈ metres, x → right, z → camera.
 */
import { MAX_ON_FLOOR } from '../../lib/staff';

export interface P {
  x: number;
  z: number;
}

export interface ShelfPos {
  x: number;
  z: number;
  /** +1 faces +z (back row of an aisle), -1 faces -z (front row). */
  facing: 1 | -1;
  aisle: number;
  pick: P;
}

export interface Layout {
  shelves: ShelfPos[];
  aisleZ: number[];
  corridorW: number;
  corridorE: number;
  storageW: number;
  tables: { x: number; z: number; stand: P }[];
  beltX: number;
  beltZ0: number;
  dockZ: number;
  doorX: number;
  vanPark: P;
  desks: P[];
  board: P;
  maxWorkers: number;
  floor: { x0: number; x1: number; z0: number; z1: number };
  zones: { text: string; at: [number, number, number] }[];
  dispatch: (i: number) => P;
}

export const MAX_SHELVES = 24;
export const SHELF_W = 2.4;
export const SHELF_D = 0.8;
export const SHELF_H = 2.2;
const PITCH_X = 2.8;
const AISLE_PITCH = 5.6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function buildLayout({ shelfCount, peakOrders, staffCount = 0 }: { shelfCount: number; peakOrders: number; staffCount?: number }): Layout {
  // Up to 8 shelves per row; rows are filled evenly so no aisle is left nearly empty
  const aisles = Math.max(1, Math.ceil(shelfCount / 16));
  const perRow = clamp(Math.ceil(shelfCount / (aisles * 2)), 3, 8);
  const storageW = perRow * PITCH_X;

  // Slots fill an aisle's back row, then its front row, then the next aisle
  const shelves: ShelfPos[] = [];
  const aisleZ: number[] = [];
  for (let a = 0; a < aisles; a++) {
    const zA = a * AISLE_PITCH;
    const zB = zA + 4.2;
    aisleZ.push(zA + 2.1);
    for (const [z, facing] of [[zA, 1], [zB, -1]] as const) {
      for (let c = 0; c < perRow && shelves.length < shelfCount; c++) {
        const x = PITCH_X / 2 + c * PITCH_X;
        shelves.push({ x, z, facing, aisle: a, pick: { x, z: z + facing * 0.85 } });
      }
    }
  }
  const storageEnd = (aisles - 1) * AISLE_PITCH + 4.6;

  // Capacity scales with the busiest hour
  const tableCount = clamp(Math.ceil(peakOrders / 12), 2, 6);
  const deskCount = clamp(Math.ceil(peakOrders / 12), 2, 8);
  // Named staff decide the team size; otherwise it scales with volume
  const maxWorkers = staffCount > 0 ? Math.min(staffCount, MAX_ON_FLOOR) : clamp(Math.ceil(peakOrders / 4), 4, 14);

  const tablesX = storageW + 3.1;
  const tables = Array.from({ length: tableCount }, (_, i) => {
    const z = 0.6 + i * 2.1;
    return { x: tablesX, z, stand: { x: tablesX - 0.95, z } };
  });
  const beltX = tablesX + 1.6;
  const dockZ = Math.max(tables[tables.length - 1].z + 2, storageEnd);
  const doorX = beltX + 2.2;

  const deskRows = Math.ceil(deskCount / 2);
  const desks = Array.from({ length: deskCount }, (_, i) => ({ x: -5.8 + (i % 2) * 2.2, z: 0.2 + Math.floor(i / 2) * 2.2 }));
  const deskEnd = 0.2 + (deskRows - 1) * 2.2;
  const board = { x: -2.4, z: deskEnd + 1.2 };
  const dispatchZ = board.z + 1.1;
  // Waiting staff line up four abreast in front of the order board
  const dispatchEnd = dispatchZ + (Math.ceil(maxWorkers / 4) - 1) * 0.6;

  const floor = { x0: -7.6, x1: doorX, z0: -1.6, z1: Math.max(dispatchEnd + 2.6, dockZ + 3.1, storageEnd + 1.5) };

  return {
    shelves,
    aisleZ,
    corridorW: -0.9,
    corridorE: storageW + 0.9,
    storageW,
    tables,
    beltX,
    beltZ0: -0.4,
    dockZ,
    doorX,
    vanPark: { x: doorX + 2.6, z: dockZ },
    desks,
    board,
    maxWorkers,
    floor,
    zones: [
      { text: 'Salg', at: [-4.7, 0, -0.9] },
      { text: 'Lager', at: [storageW / 2, 0, -1.05] },
      { text: 'Pakning', at: [tablesX, 0, -0.9] },
      { text: 'Udlevering', at: [doorX + 2.6, 0, dockZ + 1.9] },
    ],
    dispatch: (i) => ({ x: -3.4 + (i % 4) * 0.55, z: dispatchZ + Math.floor(i / 4) * 0.6 }),
  };
}
