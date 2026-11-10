/**
 * GateBudget — one Durable Object for the whole door.
 *
 * It keeps two things:
 *   - today's count of keeper turns (UTC day), against the manifest's
 *     dailyTurnBudget. Each turn is one chat call and, from
 *     minTurnsBeforeJudge on, one judge call, so the count caps the day's
 *     model bill however the traffic arrives: VPNs, Tor, or a botnet.
 *   - the proof-of-work challenges already redeemed, so one solved puzzle
 *     opens one session, not a stream of them. Entries expire with their
 *     challenge and an alarm sweeps them.
 *
 * One instance (idFromName('door')) serialises every update, so the count
 * cannot be raced. Nothing about visitors is stored: a number and some
 * random challenge ids.
 */

const today = () => new Date().toISOString().slice(0, 10);

// A non-positive or missing limit means no cap.
export const budgetExhausted = (count, limit) =>
  Number.isFinite(limit) && limit > 0 && count >= limit;

export class GateBudget {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { op, limit, id, exp } = await request.json();
    if (op === 'peek') return Response.json(await this.peek(limit));
    if (op === 'spend') return Response.json(await this.spend(limit));
    if (op === 'redeem') return Response.json(await this.redeem(id, exp));
    return Response.json({ error: 'unknown op' }, { status: 400 });
  }

  async turns() {
    const rec = await this.ctx.storage.get('turns');
    return rec && rec.day === today() ? rec : { day: today(), count: 0 };
  }

  async peek(limit) {
    const rec = await this.turns();
    return { exhausted: budgetExhausted(rec.count, limit), count: rec.count };
  }

  async spend(limit) {
    const rec = await this.turns();
    if (budgetExhausted(rec.count, limit)) return { ok: false, count: rec.count };
    rec.count += 1;
    await this.ctx.storage.put('turns', rec);
    return { ok: true, count: rec.count };
  }

  async redeem(id, exp) {
    if (typeof id !== 'string' || !id) return { ok: false };
    const key = `pow:${id}`;
    if (await this.ctx.storage.get(key)) return { ok: false };
    await this.ctx.storage.put(key, exp);
    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm((exp + 60) * 1000);
    }
    return { ok: true };
  }

  async alarm() {
    const now = Math.floor(Date.now() / 1000);
    let next = null;
    const spent = await this.ctx.storage.list({ prefix: 'pow:' });
    for (const [key, exp] of spent) {
      if (exp < now) await this.ctx.storage.delete(key);
      else next = next === null ? exp : Math.min(next, exp);
    }
    if (next !== null) await this.ctx.storage.setAlarm((next + 60) * 1000);
  }
}

async function call(env, body) {
  const stub = env.GATE_BUDGET.get(env.GATE_BUDGET.idFromName('door'));
  const res = await stub.fetch(new Request('https://gate-budget/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return res.json();
}

/** Has today's budget run out? Unknown (an error) counts as not. */
export async function budgetResting(env, manifest) {
  try {
    return (await call(env, { op: 'peek', limit: manifest.dailyTurnBudget })).exhausted === true;
  } catch (e) {
    console.error('budget peek failed', e?.message || e);
    return false;
  }
}

/**
 * Take one turn from today's budget. False when it has run out. If the
 * budget itself cannot be reached the turn is refused: the cap exists to
 * bound spending, so it fails closed.
 */
export async function spendTurn(env, manifest) {
  try {
    return (await call(env, { op: 'spend', limit: manifest.dailyTurnBudget })).ok === true;
  } catch (e) {
    console.error('budget spend failed', e?.message || e);
    return false;
  }
}

/** Mark a proof-of-work challenge used. False if it was used before. */
export async function redeemPow(env, id, exp) {
  try {
    return (await call(env, { op: 'redeem', id, exp })).ok === true;
  } catch (e) {
    console.error('pow redeem failed', e?.message || e);
    return false;
  }
}
