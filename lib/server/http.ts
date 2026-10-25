import { NextResponse } from 'next/server';
import { HttpError } from './actions';
import { requireUser, isResponse } from '@/lib/auth/server';
import type { Action } from '@/lib/auth/permissions';
import type { Session } from '@/lib/auth/session';

/** Wrap a route: auth (+ optional permission), JSON out, typed errors → status codes. */
export function route<T>(action: Action | null, fn: (s: Session, req: Request, params: Record<string, string>) => Promise<T>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    const s = await requireUser(action ?? undefined);
    if (isResponse(s)) return s;
    try {
      const params = ctx?.params ? await ctx.params : {};
      const data = await fn(s, req, params);
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}
