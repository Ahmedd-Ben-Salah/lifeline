/** Spherical geometry on Mars (and any sphere). Angles in degrees, longitudes °E in −180..180. */
export const MARS_RADIUS_KM = 3389.5;
const D = Math.PI / 180;

export interface LatLon { lat: number; lon: number }

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Great-circle central angle (rad). */
export function centralAngle(a: LatLon, b: LatLon) {
  const s = Math.sin((b.lat - a.lat) * D / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin((b.lon - a.lon) * D / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
export const distanceKm = (a: LatLon, b: LatLon, R = MARS_RADIUS_KM) => centralAngle(a, b) * R;

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon) {
  const y = Math.sin((b.lon - a.lon) * D) * Math.cos(b.lat * D);
  const x = Math.cos(a.lat * D) * Math.sin(b.lat * D) - Math.sin(a.lat * D) * Math.cos(b.lat * D) * Math.cos((b.lon - a.lon) * D);
  return ((Math.atan2(y, x) / D) + 360) % 360;
}

/** Destination after travelling distanceKm on a great circle with a given bearing. */
export function destination(p: LatLon, bearingDeg: number, distKm: number, R = MARS_RADIUS_KM): LatLon {
  const d = distKm / R, b = bearingDeg * D, la = p.lat * D, lo = p.lon * D;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return { lat: lat2 / D, lon: wrapLon(lon2 / D) };
}

/** Points along the great circle a→b (inclusive). */
export function greatCircle(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const d = centralAngle(a, b);
  if (d < 1e-9) return [a, b];
  const out: LatLon[] = [];
  const la1 = a.lat * D, lo1 = a.lon * D, la2 = b.lat * D, lo2 = b.lon * D;
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    out.push({ lat: Math.atan2(z, Math.hypot(x, y)) / D, lon: Math.atan2(y, x) / D });
  }
  return out;
}

/** Signed cross-track distance (km) of p from the great circle a→(bearing). Positive = right of track. */
export function crossTrackKm(start: LatLon, brg: number, p: LatLon, R = MARS_RADIUS_KM) {
  const d13 = centralAngle(start, p), t13 = bearing(start, p) * D, t12 = brg * D;
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R;
}

/** Polyline length in km. */
export function pathKm(pts: LatLon[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distanceKm(pts[i - 1], pts[i]);
  return s;
}
