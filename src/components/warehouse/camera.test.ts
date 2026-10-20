import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildLayout } from './layout';
import { fitPose } from './camera';

describe('overview camera', () => {
  it('keeps the floor, van and dock inside the frame with room for the top-5 panel', () => {
    for (const shelfCount of [4, 12, 24]) {
      const L = buildLayout({ shelfCount, peakOrders: 40 });
      const aspect = 1200 / 540;
      const inset = 0.23;
      const { pose } = fitPose(L, true, aspect, 40, inset);
      const cam = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
      cam.position.copy(pose.pos);
      cam.lookAt(pose.look);
      cam.updateMatrixWorld();
      const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(cam);
      const corners = [
        p(L.floor.x0, 0, L.floor.z1), p(L.floor.x0, 0, L.floor.z0),
        p(L.vanPark.x + 2.7, 0, L.dockZ + 0.8), p(L.vanPark.x + 2.7, 2, L.dockZ - 0.8),
        p(L.floor.x1, 0, L.floor.z1),
      ];
      for (const c of corners) {
        expect(c.x).toBeGreaterThan(-1 + 2 * inset - 0.001);
        expect(c.x).toBeLessThan(0.97);
        expect(Math.abs(c.y)).toBeLessThan(0.97);
      }
    }
  });

  it('keeps the top free for the full-screen clock and numbers', () => {
    const L = buildLayout({ shelfCount: 12, peakOrders: 40 });
    const aspect = 1440 / 760;
    const top = 150 / 760;
    const { pose } = fitPose(L, true, aspect, 40, 0.23, top);
    const cam = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
    cam.position.copy(pose.pos);
    cam.lookAt(pose.look);
    cam.updateMatrixWorld();
    const sign = new THREE.Vector3(L.storageW / 2, 7.1, L.floor.z0 - 0.3).project(cam);
    const front = new THREE.Vector3(L.floor.x0, 0, L.floor.z1).project(cam);
    expect(sign.y).toBeLessThan(1 - 2 * top);
    expect(front.y).toBeGreaterThan(-0.97);
  });
});
