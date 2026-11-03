import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate";
import { schemaTables } from "../../src/db/schema";
import { testDb } from "./helpers";
import { inject } from "vitest";

const t = testDb();
afterAll(() => t.close());

describe("migraciones y esquema", () => {
  it("volver a migrar no aplica nada (idempotente)", async () => {
    expect(await migrate(inject("dbUrl"))).toEqual([]);
  });

  it("los tipos de Drizzle coinciden con las columnas reales", async () => {
    for (const [name, table] of Object.entries(schemaTables)) {
      const rows = await t.admin<{ column_name: string; is_nullable: string }[]>`
        select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = ${name} order by column_name`;
      const db = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable === "NO"]));
      const ts = Object.fromEntries(Object.values(getTableColumns(table)).map((c) => [c.name, c.notNull]));
      expect({ table: getTableConfig(table).name, columns: ts }).toEqual({ table: name, columns: db });
    }
  });

  it("todas las tablas de negocio tienen RLS y agency_id", async () => {
    const rows = await t.admin<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;
    for (const r of rows) expect(r, r.relname).toMatchObject({ relrowsecurity: true });
    const withAgency = await t.admin<{ table_name: string }[]>`
      select table_name from information_schema.columns where table_schema = 'public' and column_name = 'agency_id'`;
    const names = new Set(withAgency.map((r) => r.table_name));
    for (const r of rows.filter((r) => r.relname !== "agencies")) expect(names, r.relname).toContain(r.relname);
  });
});
