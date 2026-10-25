/**
 * Sessions: a signed JWT (HS256, AUTH_SECRET) in an httpOnly cookie. Works on serverless and offline.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@/lib/server/types';

export const COOKIE = 'lifeline_session';
export interface Session { email: string; name: string; role: Role; colony?: string; title: string; site: 'mars' | 'earth' }

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || 'lifeline-dev-secret-change-me-in-production-please');

export async function signSession(s: Session) {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(secret());
}
export async function verifySession(token?: string): Promise<Session | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return payload as unknown as Session; } catch { return null; }
}
