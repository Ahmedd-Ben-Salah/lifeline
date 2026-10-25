import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE, verifySession, Session } from './session';
import { can, Action } from './permissions';

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  return verifySession(c.get(COOKIE)?.value);
}

/** For route handlers: returns the session or a 401/403 response. */
export async function requireUser(action?: Action): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (action && !can(s.role, action)) return NextResponse.json({ error: `Your role (${s.role}) cannot do this.` }, { status: 403 });
  return s;
}
export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
