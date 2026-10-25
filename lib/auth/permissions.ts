/** Role → permission matrix (docs/06_auth_and_roles.md). Checked on the server and used to hide UI. */
import type { Role } from '@/lib/server/types';

export type Action = 'ask' | 'acceptOffer' | 'createTransfer' | 'approveOrder' | 'fulfilOrder' | 'editPolicy' | 'editAutomation' | 'demo' | 'runForecast';

const M: Record<Action, Role[]> = {
  ask: ['OPERATOR', 'EARTH', 'ADMIN'],
  acceptOffer: ['OPERATOR', 'ADMIN'],
  createTransfer: ['OPERATOR', 'ADMIN'],
  approveOrder: ['OPERATOR', 'EARTH', 'ADMIN'],
  fulfilOrder: ['EARTH', 'SUPPLIER', 'ADMIN'],
  editPolicy: ['ADMIN'],
  editAutomation: ['ADMIN'],
  demo: ['ADMIN'],
  runForecast: ['OPERATOR', 'EARTH', 'ADMIN'],
};
export const can = (role: Role | undefined, a: Action) => !!role && M[a].includes(role);

/** SUPPLIER sees Resupply only. */
export function canView(role: Role | undefined, path: string) {
  if (!role) return false;
  if (role === 'SUPPLIER') return path.startsWith('/app/resupply') || path.startsWith('/app/settings');
  return true;
}
