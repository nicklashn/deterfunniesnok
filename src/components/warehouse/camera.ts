/** Overview camera framing, kept free of React so it can be tested. */
import * as THREE from 'three';
import { SHELF_H, type Layout } from './layout';
import type { Pose } from './intro';

/** Height of the tallest sales column on top of a shelf. */
export const COLUMN_MAX = 1.6;
const ELEV = 0.88; // ~50° above the horizon
const MARGIN = 1.06;

/** Width of the top-5 panel plus its gap; must match .leaderboard in styles.css. */
export const leaderboardWidth = (w: number) => Math.min(340, Math.max(220, w * 0.22)) + 16;

/**
 * Camera pose that fits the whole warehouse (floor, sign, yard and van) into the canvas with a 6 %
 * margin, leaving room for the top-5 panel on the left and (in full screen) the clock and numbers on
 * top. Insets are fractions of the canvas width/height. Iterates distance and centring on the
 * projected bounding points, so perspective is taken into account.
 */
export function fitPose(L: Layout, sign: boolean, aspect: number, fov: number, leftInset: number, topInset = 0): { d: number; pose: Pose } {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
  const xs = [L.floor.x0 - 0.3, L.vanPark.x + 3.4];
  const zBack = L.floor.z0 - 0.3;
  const zFront = L.floor.z1 + 0.3;
  const pts: THREE.Vector3[] = [];
  for (const x of xs) {
    pts.push(new THREE.Vector3(x, 0, zFront), new THREE.Vector3(x, 0, zBack), new THREE.Vector3(x, 3.1, zBack));
  }
  // Top of the sign and of the shelf labels
  if (sign) pts.push(new THREE.Vector3(L.storageW / 2, 7.1, zBack));
  const labelTop = SHELF_H + COLUMN_MAX + 1.6;
  pts.push(new THREE.Vector3(0, labelTop, L.shelves[0].z), new THREE.Vector3(L.storageW, labelTop, L.shelves[0].z));

  const lo = -1 + 2 * leftInset;
  const hi = 1 - 2 * topInset;
  const dir = new THREE.Vector3(0.03, Math.sin(ELEV), Math.cos(ELEV)).normalize();
  const target = new THREE.Vector3((xs[0] + xs[1]) / 2, 0, (zBack + zFront) / 2);
  const v = new THREE.Vector3();
  const measure = (d: number) => {
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    return { minX, maxX, minY, maxY };
  };
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  let d = 40;
  for (let it = 0; it < 6; it++) {
    let a = 4, b = 600;
    for (let k = 0; k < 32; k++) {
      const m = (a + b) / 2;
      const r = measure(m);
      if (r.maxX - r.minX <= (1 - lo) / MARGIN && r.maxY - r.minY <= (hi + 1) / MARGIN) b = m;
      else a = m;
    }
    d = b;
    const r = measure(d);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    target.addScaledVector(right, ((r.maxX + r.minX) / 2 - (1 + lo) / 2) * d * tanV * aspect);
    target.z -= ((r.maxY + r.minY) / 2 - (hi - 1) / 2) * d * tanV / Math.sin(ELEV);
  }
  return { d, pose: { pos: target.clone().addScaledVector(dir, d), look: target.clone() } };
}

