/** Demo accounts (password: lifeline-demo). Hash = bcrypt cost 10. */
import type { Role } from '@/lib/server/types';

export interface User { email: string; name: string; role: Role; colony?: string; title: string; site: 'mars' | 'earth' }
const HASH = '$2b$10$NlcjXpthoucZZDmqui4AIOKzo3BvawNgKInbpJZdT6.IQXA4Imsw.';

export const USERS: (User & { hash: string })[] = [
  { email: 'ayari@jezero.base', name: 'Ayari', role: 'ADMIN', colony: 'jezero', title: 'Ops officer', site: 'mars', hash: HASH },
  { email: 'lina@utopia.base', name: 'Lina M.', role: 'OPERATOR', colony: 'utopia', title: 'Ops officer', site: 'mars', hash: HASH },
  { email: 'control@earth.gov', name: 'Earth control', role: 'EARTH', title: 'Mission control', site: 'earth', hash: HASH },
  { email: 'supply@cargo.co', name: 'Cargo supplier', role: 'SUPPLIER', title: 'Launch & cargo', site: 'earth', hash: HASH },
  { email: 'jury@lumen.org', name: 'Jury', role: 'VIEWER', title: 'Viewer', site: 'earth', hash: HASH },
];

export const findUser = (email: string) => USERS.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
