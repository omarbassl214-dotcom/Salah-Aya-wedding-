import { neon } from '@neondatabase/serverless';

// Only the server reads this credential. Never put it in public/ or commit .env.
let storePromise;
export function getStore() {
  if (!storePromise) storePromise = connect().catch(error => { storePromise = undefined; throw error; });
  return storePromise;
}
async function connect() {
  const connection = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connection) throw new Error('DATABASE_URL is required');
  const sql = neon(connection);
  await sql`CREATE TABLE IF NOT EXISTS wedding_rsvps (
    guest_key TEXT PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    attending BOOLEAN NOT NULL,
    companions INTEGER NOT NULL DEFAULT 0 CHECK (companions BETWEEN 0 AND 999),
    note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (attending OR companions = 0)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS wedding_rate_limits (
    key TEXT PRIMARY KEY, hits INTEGER NOT NULL, window_start TIMESTAMPTZ NOT NULL
  )`;
  return {
    async get(key) {
      return (await sql`SELECT id, attending, companions, note FROM wedding_rsvps WHERE guest_key = ${key}`)[0] || null;
    },
    async save(key, value) {
      // The primary key makes retries and simultaneous requests update one response.
      return (await sql`INSERT INTO wedding_rsvps (guest_key,id,attending,companions,note)
        VALUES (${key},${value.id},${value.attending},${value.companions},${value.note})
        ON CONFLICT (guest_key) DO UPDATE SET attending=EXCLUDED.attending,
          companions=EXCLUDED.companions,note=EXCLUDED.note,updated_at=NOW()
        RETURNING id, attending, companions, note`)[0];
    },
    async counts() {
      const [row] = await sql`SELECT
        COALESCE(SUM(CASE WHEN attending THEN 1 + companions ELSE 0 END),0)::INTEGER AS yes,
        COUNT(*) FILTER (WHERE NOT attending)::INTEGER AS no FROM wedding_rsvps`;
      return row;
    },
    async reset() {
      await sql`DELETE FROM wedding_rsvps`;
      await sql`DELETE FROM wedding_rate_limits`;
      return { ok: true };
    },
    async allow(key) {
      const [row] = await sql`INSERT INTO wedding_rate_limits (key,hits,window_start)
        VALUES (${key},1,date_trunc('hour',NOW()))
        ON CONFLICT (key) DO UPDATE SET
          hits=CASE WHEN wedding_rate_limits.window_start < date_trunc('hour',NOW()) THEN 1 ELSE wedding_rate_limits.hits+1 END,
          window_start=date_trunc('hour',NOW())
        RETURNING hits`;
      return row.hits <= 120;
    }
  };
}
