/**
 * Launch windows. Earth→Mars windows open roughly every 26 months (the synodic period, ~780 days).
 * We find the window as the departure date with the lowest launch energy (C3) from a Lambert scan:
 *  1) coarse scan: departures every 4 days for ~26 months, flight times 150–330 days
 *  2) fine scan:   ±12 days around the coarse best, 1-day / 5-day steps
 */
import { transfer, Transfer } from './lambert';

export const SYNODIC_DAYS = 779.94;

export function findWindow(startJd: number, spanDays = 800): Transfer {
  let best: Transfer | null = null;
  for (let d = 0; d <= spanDays; d += 4) {
    for (let tof = 150; tof <= 330; tof += 15) {
      const t = transfer(startJd + d, tof);
      if (t && (!best || t.c3 < best.c3)) best = t;
    }
  }
  if (!best) throw new Error('no transfer found');
  const coarse: Transfer = best;
  for (let d = -12; d <= 12; d += 1) {
    for (let tof = coarse.tofDays - 20; tof <= coarse.tofDays + 20; tof += 2) {
      const t = transfer(coarse.depJd + d, tof);
      if (t && t.c3 < best!.c3) best = t;
    }
  }
  return best!;
}

/** "Window is open" = departures with C3 within this margin of the minimum (typical mission design ~ +4 km²/s²). */
export const WINDOW_C3_MARGIN = 4;
