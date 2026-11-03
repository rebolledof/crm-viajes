import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { migrate } from "../../src/db/migrate";

// Base de datos efímera: se recrea en cada ejecución con el stub de Supabase y todas las migraciones.
const ADMIN_URL = process.env.DATABASE_URL_ADMIN ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DB_NAME = "crm_viajes_test";

export default async function setup(project: TestProject) {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin.unsafe(`create database ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  const testUrl = url.toString();

  const db = postgres(testUrl, { max: 1, onnotice: () => {} });
  await db.unsafe(await readFile(path.join(__dirname, "supabase-stub.sql"), "utf8"));
  await db.end();
  await migrate(testUrl);

  project.provide("dbUrl", testUrl);
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
