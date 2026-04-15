import type { FieldModel } from './types';

export type Rotation = 0 | 90 | 180 | 270;

/** Compute display dimensions after rotation */
export function displayDims(w: number, h: number, rot: Rotation): [number, number] {
  return rot === 90 || rot === 270 ? [h, w] : [w, h];
}

/** Map screen-space deltas to field-space deltas given rotation + zoom */
export function screenToFieldDelta(dx: number, dy: number, zoom: number, rot: Rotation): [number, number] {
  const sx = dx / zoom;
  const sy = dy / zoom;
  switch (rot) {
    case 90: return [sy, -sx];
    case 180: return [-sx, -sy];
    case 270: return [-sy, sx];
    default: return [sx, sy];
  }
}

function center(f: FieldModel) {
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
}

function rangeOverlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Find nearest field in direction using edge-based distances.
 * 1) Filter candidates strictly in requested direction (by center).
 * 2) Partition into overlapping (on orthogonal axis) vs non-overlapping.
 * 3) Among overlapping: pick min primary-edge distance, tie-break by orth center distance.
 * 4) Fallback to non-overlapping: pick min primary-edge + orth distance.
 */
export function findNearestField(
  currentId: string,
  fields: FieldModel[],
  direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
): FieldModel | null {
  const cur = fields.find((f) => f.id === currentId);
  if (!cur) return null;

  const cc = center(cur);

  type Scored = { f: FieldModel; primaryEdgeDist: number; orthCenterDist: number; hasOverlap: boolean };
  const candidates: Scored[] = [];

  for (const cand of fields) {
    if (cand.id === currentId) continue;
    const pc = center(cand);

    let primaryEdgeDist: number;
    let orthCenterDist: number;
    let hasOverlap: boolean;

    if (direction === 'ArrowRight') {
      if (pc.x <= cc.x + 1) continue;
      primaryEdgeDist = cand.x - (cur.x + cur.w);
      hasOverlap = rangeOverlap(cur.y, cur.y + cur.h, cand.y, cand.y + cand.h) > 0;
      orthCenterDist = Math.abs(pc.y - cc.y);
    } else if (direction === 'ArrowLeft') {
      if (pc.x >= cc.x - 1) continue;
      primaryEdgeDist = cur.x - (cand.x + cand.w);
      hasOverlap = rangeOverlap(cur.y, cur.y + cur.h, cand.y, cand.y + cand.h) > 0;
      orthCenterDist = Math.abs(pc.y - cc.y);
    } else if (direction === 'ArrowDown') {
      if (pc.y <= cc.y + 1) continue;
      primaryEdgeDist = cand.y - (cur.y + cur.h);
      hasOverlap = rangeOverlap(cur.x, cur.x + cur.w, cand.x, cand.x + cand.w) > 0;
      orthCenterDist = Math.abs(pc.x - cc.x);
    } else { // ArrowUp
      if (pc.y >= cc.y - 1) continue;
      primaryEdgeDist = cur.y - (cand.y + cand.h);
      hasOverlap = rangeOverlap(cur.x, cur.x + cur.w, cand.x, cand.x + cand.w) > 0;
      orthCenterDist = Math.abs(pc.x - cc.x);
    }

    candidates.push({ f: cand, primaryEdgeDist: Math.max(0, primaryEdgeDist), orthCenterDist, hasOverlap });
  }

  if (candidates.length === 0) return null;

  // Prefer overlapping candidates (physically aligned on the orthogonal axis)
  const overlapping = candidates.filter((c) => c.hasOverlap);
  const pool = overlapping.length > 0 ? overlapping : candidates;

  pool.sort((a, b) => {
    const dp = a.primaryEdgeDist - b.primaryEdgeDist;
    if (Math.abs(dp) > 1) return dp;
    return a.orthCenterDist - b.orthCenterDist;
  });

  return pool[0].f;
}
