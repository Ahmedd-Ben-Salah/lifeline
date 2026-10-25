/**
 * Cargo packer — first-fit decreasing by mass, with life-critical categories first.
 * Ship capacity 100 t to the Martian surface (assumption: Starship-class cargo lander).
 */
export type Category = 'O2' | 'WATER' | 'FOOD' | 'SPARES' | 'ROVERS';
export const CATEGORY_ORDER: Category[] = ['O2', 'WATER', 'FOOD', 'SPARES', 'ROVERS'];
export const CATEGORY_LABEL: Record<Category, string> = { O2: 'O₂ & ECLSS', WATER: 'Water', FOOD: 'Food', SPARES: 'Spares', ROVERS: 'Rovers' };
export const SHIP_CAPACITY_T = 100;

export interface CargoItem { id: string; category: Category; label: string; massT: number }
export interface PackedShip { ship: string; items: CargoItem[]; massT: number; fillPct: number; byCategory: Partial<Record<Category, number>> }

/** Split category demand (tonnes) into standard pallets/tanks so the packer has real items to place. */
export function itemsFromDemand(demand: Partial<Record<Category, number>>): CargoItem[] {
  const unit: Record<Category, number> = { O2: 6, WATER: 8, FOOD: 6, SPARES: 5, ROVERS: 11 };
  const items: CargoItem[] = [];
  for (const cat of CATEGORY_ORDER) {
    let left = demand[cat] ?? 0, n = 1;
    while (left > 0.001) {
      const m = Math.min(unit[cat], left);
      items.push({ id: `${cat}-${n}`, category: cat, label: `${CATEGORY_LABEL[cat]} ${n}`, massT: Math.round(m * 10) / 10 });
      left -= m; n++;
    }
  }
  return items;
}

export function packCargo(items: CargoItem[], shipNames: string[], capacityT = SHIP_CAPACITY_T): { ships: PackedShip[]; unplaced: CargoItem[] } {
  const prio = (c: Category) => CATEGORY_ORDER.indexOf(c);
  const sorted = items.slice().sort((a, b) => prio(a.category) - prio(b.category) || b.massT - a.massT);
  const ships: PackedShip[] = shipNames.map(ship => ({ ship, items: [], massT: 0, fillPct: 0, byCategory: {} }));
  const unplaced: CargoItem[] = [];
  for (const it of sorted) {
    // place in the least-loaded ship that fits: spreads life-critical cargo across ships (loss of one ship ≠ loss of all O₂)
    const fit = ships.filter(s => s.massT + it.massT <= capacityT + 1e-9).sort((a, b) => a.massT - b.massT)[0];
    if (!fit) { unplaced.push(it); continue; }
    fit.items.push(it); fit.massT += it.massT;
    fit.byCategory[it.category] = (fit.byCategory[it.category] || 0) + it.massT;
  }
  ships.forEach(s => { s.massT = Math.round(s.massT * 10) / 10; s.fillPct = s.massT / capacityT; });
  return { ships, unplaced };
}
