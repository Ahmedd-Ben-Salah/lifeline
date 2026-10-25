import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { findUser } from '@/lib/auth/users';
import { signSession, COOKIE } from '@/lib/auth/session';

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const u = findUser(String(email || ''));
  if (!u || !(await bcrypt.compare(String(password || ''), u.hash))) return NextResponse.json({ error: 'Email or password is wrong.' }, { status: 401 });
  const token = await signSession({ email: u.email, name: u.name, role: u.role, colony: u.colony, title: u.title, site: u.site });
  const res = NextResponse.json({ ok: true, role: u.role, home: u.role === 'SUPPLIER' ? '/app/resupply' : '/app' });
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400 });
  return res;
}
