/**
 * A simulated GPS constellation and the positioning math that turns satellite
 * signals back into a lat/lng fix — the "simulate satellites and make them
 * work" part of GhMap.
 *
 * How real GPS works, and what we reproduce here:
 *  1. Satellites orbit at a known altitude on known paths, so at any instant we
 *     can compute each one's position in space (ECEF metres).
 *  2. A receiver measures how long each signal took to arrive → a *pseudo*range
 *     (pseudo because the receiver's clock is biased by an unknown offset).
 *  3. With 4+ satellites we solve for 4 unknowns — the receiver's x, y, z and
 *     its clock bias — by iterated least squares (Gauss–Newton). That is
 *     trilateration, and it's exactly what a GPS chip does.
 *
 * The orbits here are a simplified circular model: good enough to produce a
 * realistic, geometry-dependent fix over Ghana, without the full ephemeris.
 */
import type { LatLng, Vec3 } from "./geo.ts";
import {
  EARTH_RADIUS_M,
  distance3d,
  fromECEF,
  norm,
  subtract,
  toECEF,
  toRadians,
} from "./geo.ts";

/** Speed of light in m/s — the constant that converts signal time to distance. */
export const SPEED_OF_LIGHT = 299_792_458;

/** GPS satellites orbit at ~20,200 km altitude (medium Earth orbit). */
export const GPS_ALTITUDE_M = 20_200_000;

/** Orbital radius from Earth's centre. */
const ORBIT_RADIUS = EARTH_RADIUS_M + GPS_ALTITUDE_M;

/** GPS orbital period is close to half a sidereal day (~11h 58m), in seconds. */
export const ORBITAL_PERIOD_S = 43_082;

export interface OrbitalElements {
  readonly id: string;
  /** Right ascension of the ascending node (deg) — which orbital plane. */
  readonly raan: number;
  /** Inclination of the orbit relative to the equator (deg). */
  readonly inclination: number;
  /** Phase angle of the satellite within its plane at t=0 (deg). */
  readonly phase: number;
}

export interface SatelliteState {
  readonly id: string;
  readonly position: Vec3;
  /** Height above the receiver's local horizon, in degrees (−90…90). */
  readonly elevationDeg: number;
}

/**
 * Build a Walker-style constellation: `planes` evenly spaced orbital planes,
 * each holding `perPlane` satellites. The real GPS constellation is 6 planes ×
 * ~4 satellites at 55° inclination; that's the default.
 */
export function buildConstellation(
  planes = 6,
  perPlane = 4,
  inclination = 55,
): OrbitalElements[] {
  const sats: OrbitalElements[] = [];
  for (let p = 0; p < planes; p++) {
    const raan = (360 / planes) * p;
    for (let s = 0; s < perPlane; s++) {
      // Offset each plane's phase a little so satellites don't line up.
      const phase = (360 / perPlane) * s + (p * 360) / (planes * perPlane);
      sats.push({
        id: `GH-SAT-${p + 1}-${s + 1}`,
        raan,
        inclination,
        phase,
      });
    }
  }
  return sats;
}

/** Position of one satellite at simulation time `tSeconds`, in ECEF metres. */
export function satellitePosition(
  sat: OrbitalElements,
  tSeconds: number,
): Vec3 {
  // Angle travelled within the orbital plane.
  const meanMotion = (2 * Math.PI) / ORBITAL_PERIOD_S;
  const theta = toRadians(sat.phase) + meanMotion * tSeconds;

  // Position in the orbital plane (before tilting/rotating into ECEF).
  const xOrbit = ORBIT_RADIUS * Math.cos(theta);
  const yOrbit = ORBIT_RADIUS * Math.sin(theta);

  const inc = toRadians(sat.inclination);
  const raan = toRadians(sat.raan);

  // Tilt by inclination about the x-axis, then rotate by RAAN about z.
  const xIncl = xOrbit;
  const yIncl = yOrbit * Math.cos(inc);
  const zIncl = yOrbit * Math.sin(inc);

  return {
    x: xIncl * Math.cos(raan) - yIncl * Math.sin(raan),
    y: xIncl * Math.sin(raan) + yIncl * Math.cos(raan),
    z: zIncl,
  };
}

/**
 * Elevation angle of a satellite above the receiver's local horizon, in
 * degrees. Satellites below ~5° are usually unusable (atmosphere, obstacles),
 * so the fix routine filters on this.
 */
export function elevationAngle(receiver: Vec3, satellite: Vec3): number {
  const up = receiver; // local "up" ≈ the geocentric radial direction
  const los = subtract(satellite, receiver); // line of sight
  const upLen = norm(up);
  const losLen = norm(los);
  if (upLen === 0 || losLen === 0) return 0;
  const cosZenith =
    (up.x * los.x + up.y * los.y + up.z * los.z) / (upLen * losLen);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  return 90 - (zenith * 180) / Math.PI;
}

/** The satellites visible from `receiver` at time `t`, above `maskDeg`. */
export function visibleSatellites(
  constellation: readonly OrbitalElements[],
  receiver: Vec3,
  tSeconds: number,
  maskDeg = 5,
): SatelliteState[] {
  const out: SatelliteState[] = [];
  for (const sat of constellation) {
    const position = satellitePosition(sat, tSeconds);
    const elevationDeg = elevationAngle(receiver, position);
    if (elevationDeg >= maskDeg) {
      out.push({ id: sat.id, position, elevationDeg });
    }
  }
  return out;
}

export interface PseudorangeMeasurement {
  readonly satellite: Vec3;
  /** Measured range including the receiver clock-bias error, in metres. */
  readonly pseudorange: number;
}

/**
 * Simulate the pseudoranges a receiver at `truePosition` would measure, given a
 * receiver clock bias (expressed in metres, = c·Δt) and optional Gaussian-ish
 * noise. This is the "signal" the solver below has to invert.
 *
 * `rng` lets callers inject determinism; defaults to Math.random.
 */
export function simulatePseudoranges(
  sats: readonly SatelliteState[],
  truePosition: Vec3,
  clockBiasM = 0,
  noiseM = 0,
  rng: () => number = Math.random,
): PseudorangeMeasurement[] {
  return sats.map((s) => {
    const geometric = distance3d(truePosition, s.position);
    const noise = noiseM > 0 ? (rng() * 2 - 1) * noiseM : 0;
    return {
      satellite: s.position,
      pseudorange: geometric + clockBiasM + noise,
    };
  });
}

export interface PositionFix {
  readonly position: LatLng & { height: number };
  readonly ecef: Vec3;
  /** Estimated receiver clock bias, in metres. */
  readonly clockBiasM: number;
  /** Satellites used in the solution. */
  readonly satellitesUsed: number;
  /** RMS of the measurement residuals — lower is a tighter fix. */
  readonly residualRmsM: number;
  /**
   * Geometric Dilution of Precision: how satellite geometry amplifies error.
   * < 2 excellent, 2–5 good, > 10 poor. A key real-GPS quality metric.
   */
  readonly gdop: number;
  readonly iterations: number;
  readonly converged: boolean;
}

/**
 * Solve for receiver position and clock bias from 4+ pseudoranges using
 * iterated least squares (Gauss–Newton). Returns null if under-determined or
 * the linear system is singular.
 *
 * Unknown state vector is [x, y, z, b] where b is the clock bias in metres.
 * Each satellite contributes one equation:  ρ_i ≈ |X − S_i| + b.
 */
export function solvePosition(
  measurements: readonly PseudorangeMeasurement[],
  options: { initialGuess?: Vec3; maxIterations?: number; tolerance?: number } = {},
): PositionFix | null {
  if (measurements.length < 4) return null;

  const maxIterations = options.maxIterations ?? 15;
  const tolerance = options.tolerance ?? 1e-4;

  // Start at Earth's centre-ish on the surface over Ghana unless told otherwise.
  let x = options.initialGuess?.x ?? EARTH_RADIUS_M;
  let y = options.initialGuess?.y ?? 0;
  let z = options.initialGuess?.z ?? 0;
  let b = 0;

  let iterations = 0;
  let converged = false;
  let lastG: number[][] = [];

  for (; iterations < maxIterations; iterations++) {
    // Build the linearised system J·Δ = r.
    const J: number[][] = [];
    const r: number[] = [];
    for (const m of measurements) {
      const dx = x - m.satellite.x;
      const dy = y - m.satellite.y;
      const dz = z - m.satellite.z;
      const range = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      // Unit line-of-sight direction; last column is 1 for the clock bias.
      J.push([dx / range, dy / range, dz / range, 1]);
      r.push(m.pseudorange - (range + b));
    }
    lastG = J;

    const delta = solveLeastSquares(J, r);
    if (!delta) return null;

    x += delta[0]!;
    y += delta[1]!;
    z += delta[2]!;
    b += delta[3]!;

    const step = Math.hypot(delta[0]!, delta[1]!, delta[2]!);
    if (step < tolerance) {
      converged = true;
      iterations++;
      break;
    }
  }

  const ecef: Vec3 = { x, y, z };

  // Residual RMS after the final update.
  let sumSq = 0;
  for (const m of measurements) {
    const predicted = distance3d(ecef, m.satellite) + b;
    const resid = m.pseudorange - predicted;
    sumSq += resid * resid;
  }
  const residualRmsM = Math.sqrt(sumSq / measurements.length);

  return {
    position: fromECEF(ecef),
    ecef,
    clockBiasM: b,
    satellitesUsed: measurements.length,
    residualRmsM,
    gdop: computeGdop(lastG),
    iterations,
    converged,
  };
}

/**
 * Solve the overdetermined linear system J·x = r in the least-squares sense by
 * forming and solving the 4×4 normal equations (JᵀJ)x = Jᵀr. Returns the
 * 4-vector solution, or null if JᵀJ is singular.
 */
function solveLeastSquares(J: number[][], r: number[]): number[] | null {
  const n = 4;
  const ata: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const atb: number[] = new Array(n).fill(0);

  for (let row = 0; row < J.length; row++) {
    const jr = J[row]!;
    const rr = r[row]!;
    for (let i = 0; i < n; i++) {
      atb[i]! += jr[i]! * rr;
      for (let k = 0; k < n; k++) {
        ata[i]![k]! += jr[i]! * jr[k]!;
      }
    }
  }
  return solve4x4(ata, atb);
}

/** Gaussian elimination with partial pivoting for a 4×4 system A·x = b. */
function solve4x4(A: number[][], b: number[]): number[] | null {
  const n = 4;
  // Augmented matrix (deep copy so we don't mutate the caller's data).
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null; // singular
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const pivotVal = M[col]![col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row]![col]! / pivotVal;
      for (let k = col; k <= n; k++) {
        M[row]![k]! -= factor * M[col]![k]!;
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) x[i] = M[i]![n]! / M[i]![i]!;
  return x;
}

/**
 * Geometric Dilution of Precision = sqrt(trace((JᵀJ)⁻¹)). Summarises how the
 * satellite geometry magnifies ranging error into position error.
 */
function computeGdop(J: number[][]): number {
  if (J.length < 4) return Infinity;
  const n = 4;
  const ata: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const jr of J) {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) ata[i]![k]! += jr[i]! * jr[k]!;
    }
  }
  const inv = invert4x4(ata);
  if (!inv) return Infinity;
  const trace = inv[0]![0]! + inv[1]![1]! + inv[2]![2]! + inv[3]![3]!;
  return trace > 0 ? Math.sqrt(trace) : Infinity;
}

/** Invert a 4×4 matrix via Gauss–Jordan, or null if singular. */
function invert4x4(A: number[][]): number[][] | null {
  const n = 4;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const pivotVal = M[col]![col]!;
    for (let k = 0; k < 2 * n; k++) M[col]![k]! /= pivotVal;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row]![col]!;
      for (let k = 0; k < 2 * n; k++) M[row]![k]! -= factor * M[col]![k]!;
    }
  }

  return M.map((row) => row.slice(n));
}

/**
 * End-to-end convenience: given a true receiver location and sim time, generate
 * the measurements a GPS chip would see and solve them back into a fix. This is
 * the function the apps call to show "GPS positioning working".
 */
export function simulateFix(
  constellation: readonly OrbitalElements[],
  truePosition: LatLng,
  tSeconds: number,
  opts: { clockBiasM?: number; noiseM?: number; maskDeg?: number; rng?: () => number } = {},
): { fix: PositionFix | null; visible: SatelliteState[]; errorM: number | null } {
  const truthEcef = toECEF(truePosition);
  const visible = visibleSatellites(
    constellation,
    truthEcef,
    tSeconds,
    opts.maskDeg ?? 5,
  );
  const measurements = simulatePseudoranges(
    visible,
    truthEcef,
    opts.clockBiasM ?? 0,
    opts.noiseM ?? 0,
    opts.rng ?? Math.random,
  );
  const fix = solvePosition(measurements, { initialGuess: toECEF(truePosition) });
  const errorM = fix ? distance3d(fix.ecef, truthEcef) : null;
  return { fix, visible, errorM };
}
