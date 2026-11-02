import { migrate } from "../src/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (conexión directa de Supabase).");
  process.exit(1);
}

migrate(url)
  .then((applied) => {
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(", ")}` : "No hay migraciones pendientes.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
