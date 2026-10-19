import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Aplica en orden las migraciones SQL pendientes, cada una en su propia transacción. */
export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create schema if not exists app`;
    await sql`create table if not exists app.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set((await sql<{ name: string }[]>`select name from app.schema_migrations`).map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into app.schema_migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}
