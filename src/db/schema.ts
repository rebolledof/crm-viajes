// Tipos de Drizzle para las tablas de supabase/migrations. El SQL es la fuente de verdad;
// tests/integration/schema.test.ts comprueba que ambos coinciden.
import { jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agencyRole = pgEnum("agency_role", ["admin", "asesor", "lectura"]);

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    agencyId: uuid("agency_id").notNull(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
    role: agencyRole("role").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.userId] })],
);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  email: text("email").notNull(),
  role: agencyRole("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  invitedBy: uuid("invited_by").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id"),
  changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schemaTables = { agencies, memberships, invitations, audit_events: auditEvents };
