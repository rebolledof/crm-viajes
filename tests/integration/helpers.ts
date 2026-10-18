import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { inject } from "vitest";
import { createDb, withUser, type Db, type SessionUser, type Tx } from "../../src/db/client";

export function testDb() {
  const url = inject("dbUrl");
  const { db, close } = createDb(url, { max: 3 });
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  return {
    db,
    admin,
    async close() {
      await close();
      await admin.end();
    },
  };
}

/** Crea un usuario en auth.users, como haría Supabase Auth. */
export async function createUser(admin: postgres.Sql, prefix: string): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${prefix}-${id.slice(0, 8)}@ejemplo.test`;
  await admin`insert into auth.users (id, email) values (${id}, ${email})`;
  return { id, email };
}

export function as<T>(db: Db, user: SessionUser, fn: (tx: Tx) => Promise<T>) {
  return withUser(db, user, fn);
}
