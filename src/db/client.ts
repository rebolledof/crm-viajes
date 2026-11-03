import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Identidad verificada por Supabase Auth. Nunca se construye con datos enviados por el navegador. */
export type SessionUser = { id: string; email: string };

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  // prepare: false es necesario con el pooler de Supabase en modo transacción.
  const client = postgres(url, { prepare: false, max: opts.max ?? 5, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/**
 * Ejecuta fn como el usuario autenticado: rol `authenticated` y claims del JWT en la transacción,
 * de modo que las políticas RLS se aplican igual que en Supabase. Toda consulta de una petición
 * de usuario debe pasar por aquí.
 */
export async function withUser<T>(db: Db, user: SessionUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

let shared: Db | undefined;

/** Conexión única por proceso para la aplicación (DATABASE_URL). */
export function getDb(): Db {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    shared = createDb(url).db;
  }
  return shared;
}
