/* Joukowski airfoil, steady 2-D potential flow with the Kutta condition.
   Dimensionless freestream speed = 1. Positive alpha raises the leading edge.
   This model intentionally has no viscosity, stall or finite-wing correction. */
(function (root) {
  'use strict';
  const CX = -0.075, CY = 0.065;
  const R = Math.hypot(1 - CX, CY);
  const TRAILING_ANGLE = Math.atan2(-CY, 1 - CX);
  const CHORD = 2 - (CX - R + 1 / (CX - R));
  function divide(ar, ai, br, bi) {
    const d = br * br + bi * bi;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
  }
  function makeModel(degrees) {
    const alpha = degrees * Math.PI / 180;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const gamma = 4 * Math.PI * R * Math.sin(alpha - TRAILING_ANGLE);
    function map(zx, zy) {
      const d = zx * zx + zy * zy;
      const x = zx + zx / d, y = zy - zy / d;
      return {x: ca * x + sa * y, y: -sa * x + ca * y};
    }
    function surface(theta) {
      return map(CX + R * Math.cos(theta), CY + R * Math.sin(theta));
    }
    function velocityAtZ(zx, zy) {
      const qx = zx - CX, qy = zy - CY;
      const dipole = divide(R * R * ca, R * R * sa, qx * qx - qy * qy, 2 * qx * qy);
      const circulation = divide(0, gamma / (2 * Math.PI), qx, qy);
      const inverseZ2 = divide(1, 0, zx * zx - zy * zy, 2 * zx * zy);
      // Complex velocity is u - iv; rotate the velocity back into world space.
      const v = divide(ca - dipole[0] + circulation[0], -sa - dipole[1] + circulation[1], 1 - inverseZ2[0], -inverseZ2[1]);
      const u = ca * v[0] - sa * v[1], w = -sa * v[0] - ca * v[1];
      return {u, v: w, speed: Math.hypot(u, w), cp: 1 - u * u - w * w};
    }
    function sample(x, y) {
      // Invert w = z + 1/z, choosing the root outside the generating circle.
      const wx = ca * x - sa * y, wy = sa * x + ca * y;
      const dr = wx * wx - wy * wy - 4, di = 2 * wx * wy;
      const magnitude = Math.hypot(dr, di);
      const sr = Math.sqrt(Math.max(0, (magnitude + dr) / 2));
      const si = (di < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (magnitude - dr) / 2));
      const ax = (wx + sr) / 2, ay = (wy + si) / 2;
      const bx = (wx - sr) / 2, by = (wy - si) / 2;
      const da = Math.hypot(ax - CX, ay - CY), db = Math.hypot(bx - CX, by - CY);
      const zx = da > db ? ax : bx, zy = da > db ? ay : by;
      if (Math.max(da, db) < R - 0.00001) return null;
      const value = velocityAtZ(zx, zy);
      return Number.isFinite(value.speed) ? value : null;
    }
    function surfaceSample(theta) {
      const point = surface(theta);
      const velocity = velocityAtZ(CX + R * 1.00001 * Math.cos(theta), CY + R * 1.00001 * Math.sin(theta));
      const before = surface(theta - 0.0001), after = surface(theta + 0.0001);
      const tx = after.x - before.x, ty = after.y - before.y, length = Math.hypot(tx, ty);
      return {...point, ...velocity, nx: -ty / length, ny: tx / length};
    }
    const outline = Array.from({length: 241}, (_, i) => surface(TRAILING_ANGLE + i / 240 * Math.PI * 2));
    return {degrees, alpha, gamma, chord: CHORD, cl: 2 * gamma / CHORD, surface, surfaceSample, sample, outline};
  }
  const api = {makeModel};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiftFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
