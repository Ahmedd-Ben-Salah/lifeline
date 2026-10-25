/**
 * Ephemeris — where Earth and Mars are on any date.
 *
 * Source: JPL "Approximate Positions of the Planets" (Standish), Table 1,
 * Keplerian elements + rates referred to the J2000 ecliptic, valid 1800–2050 AD.
 * Accuracy for Earth/Mars over that span is ~1 arc-minute, i.e. a few thousand km —
 * plenty for launch windows, light delay and seasons.
 *
 * Units: positions in AU (heliocentric ecliptic J2000), time as Julian Date (JD).
 */

export const AU_KM = 149_597_870.7;
export const C_KMS = 299_792.458;
export const GM_SUN = 1.32712440018e11; // km^3/s^2
export const J2000 = 2451545.0;
export const DEG = Math.PI / 180;
export const DAY_S = 86400;

export type Planet = 'earth' | 'mars';
export interface Vec3 { x: number; y: number; z: number }

// [value at J2000, rate per Julian century]
type El = [number, number];
interface Elements { a: El; e: El; I: El; L: El; w: El; O: El }

// a [AU], e, I [deg], L mean longitude [deg], w longitude of perihelion [deg], O longitude of ascending node [deg]
export const ELEMENTS: Record<Planet, Elements> = {
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0, 0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
};

export const jdFromDate = (d: Date | number) => (typeof d === 'number' ? d : d.getTime()) / 86400000 + 2440587.5;
export const dateFromJd = (jd: number) => new Date((jd - 2440587.5) * 86400000);

/** Solve Kepler's equation M = E − e·sin E with Newton's method. */
export function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Heliocentric ecliptic position of a planet in AU. */
export function helio(p: Planet, jd: number): Vec3 & { a: number; e: number } {
  const T = (jd - J2000) / 36525;
  const el = ELEMENTS[p];
  const g = (k: keyof Elements) => el[k][0] + el[k][1] * T;
  const a = g('a'), e = g('e'), I = g('I') * DEG, L = g('L'), wb = g('w'), O = g('O');
  let M = ((((L - wb) % 360) + 540) % 360) - 180; // mean anomaly, −180..180°
  M *= DEG;
  const w = (wb - O) * DEG, Om = O * DEG; // argument of perihelion, node
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
    a, e,
  };
}

/** Heliocentric velocity in km/s (central difference over ±30 min). */
export function helioVel(p: Planet, jd: number): Vec3 {
  const h = 1 / 48;
  const a = helio(p, jd - h), b = helio(p, jd + h);
  const k = AU_KM / (2 * h * DAY_S);
  return { x: (b.x - a.x) * k, y: (b.y - a.y) * k, z: (b.z - a.z) * k };
}

export const norm = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const toKm = (v: Vec3): Vec3 => ({ x: v.x * AU_KM, y: v.y * AU_KM, z: v.z * AU_KM });
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** Earth–Mars distance in km. */
export function earthMarsKm(jd: number): number {
  return norm(sub(helio('earth', jd), helio('mars', jd))) * AU_KM;
}

/** One-way light time Earth ↔ Mars in seconds. */
export function lightDelaySec(jd: number): number {
  return earthMarsKm(jd) / C_KMS;
}

/**
 * Solar conjunction: the Sun sits between Earth and Mars and radio links fail.
 * We flag it when the Sun–Earth–Mars angle is below ~3°.
 */
export function sunEarthMarsAngleDeg(jd: number): number {
  const E = helio('earth', jd), M = helio('mars', jd);
  const toSun = { x: -E.x, y: -E.y, z: -E.z };
  const toMars = sub(M, E);
  const c = (toSun.x * toMars.x + toSun.y * toMars.y + toSun.z * toMars.z) / (norm(toSun) * norm(toMars));
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/**
 * Mars areocentric solar longitude Ls (season). Ls = 0° northern spring equinox,
 * 90° northern summer, 180° autumn, 270° winter. Perihelion is near Ls 251°.
 * Ls ≈ heliocentric ecliptic longitude of Mars − 85.06° (Allison & McEwen 2000 offset, simplified).
 */
export function marsLs(jd: number): number {
  const m = helio('mars', jd);
  return wrap360(Math.atan2(m.y, m.x) / DEG - 85.06);
}

/** Mars Sol Date (Allison & McEwen 2000): sols since 29 Dec 1873. */
export const marsSolDate = (jd: number) => (jd - 2405522.0028779) / 1.0274912517;

/** Mars Year (Clancy et al. convention, MY 1 started 11 Apr 1955). */
export const marsYear = (jd: number) => Math.floor((jd - 2435208.5) / 686.9726) + 1;

/** Greenwich mean sidereal time as an angle (rad) — Earth's rotation. */
export const gmst = (jd: number) => wrap360(280.46061837 + 360.98564736629 * (jd - J2000)) * DEG;

/** Mars prime-meridian angle W (IAU 2015) in rad — Mars' rotation. */
export const marsW = (jd: number) => wrap360(176.63 + 350.89198226 * (jd - J2000)) * DEG;

/** Dust season on Mars: Ls 160°–340°, peak storm risk near perihelion Ls ≈ 251°. */
export function inDustSeason(ls: number) { return ls >= 160 && ls <= 340; }

/** Heliocentric longitude in rad (for phase-angle maths). */
export const helioLon = (v: Vec3) => Math.atan2(v.y, v.x);

/**
 * Sub-solar point on Mars (where the Sun is overhead) — gives the real day/night terminator.
 * Latitude = solar declination = asin(sin ε · sin Ls) with obliquity ε = 25.19°.
 * Longitude (°E) = where local mean solar time is 12:00, i.e. (12 h − MTC) × 15°/h.
 */
export function marsSubsolar(jd: number) {
  const ls = marsLs(jd) * DEG;
  const lat = Math.asin(Math.sin(25.19 * DEG) * Math.sin(ls)) / DEG;
  const mtc = (((marsSolDate(jd) % 1) + 1) % 1) * 24;
  let lon = (12 - mtc) * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}
