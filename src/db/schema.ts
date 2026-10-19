// Tipos de Drizzle para las tablas de supabase/migrations. El SQL es la fuente de verdad;
// tests/integration/schema.test.ts comprueba que ambos coinciden.
import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const stageKind = pgEnum("stage_kind", ["abierta", "ganada", "perdida"]);
export const lossReason = pgEnum("loss_reason", ["precio", "sin_disponibilidad", "cambio_de_planes", "sin_respuesta", "competencia", "otro"]);
export const contactChannel = pgEnum("contact_channel", ["whatsapp", "correo", "telefono"]);
export const consentPurpose = pgEnum("consent_purpose", ["servicio", "promociones"]);
export const consentStatus = pgEnum("consent_status", ["otorgado", "retirado"]);
export const taskKind = pgEnum("task_kind", ["llamada", "seguimiento", "recordatorio", "correo", "reunion", "tarea"]);
export const taskStatus = pgEnum("task_status", ["abierta", "completada", "cancelada"]);
export const priority = pgEnum("priority", ["baja", "media", "alta"]);
export const currencyCode = pgEnum("currency_code", ["COP", "USD"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  kind: stageKind("kind").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  fullName: text("full_name").notNull(),
  language: text("language"),
  city: text("city"),
  tags: text("tags").array().notNull().default([]),
  ownerId: uuid("owner_id"),
  source: text("source"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactPhones = pgTable("contact_phones", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  e164: text("e164").notNull(),
  label: text("label"),
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdAt: createdAt(),
});

export const contactEmails = pgTable("contact_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  email: text("email").notNull(),
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdAt: createdAt(),
});

export const contactConsents = pgTable("contact_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  channel: contactChannel("channel").notNull(),
  purpose: consentPurpose("purpose").notNull(),
  status: consentStatus("status").notNull(),
  source: text("source").notNull(),
  actorId: uuid("actor_id").notNull(),
  createdAt: createdAt(),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  stageId: uuid("stage_id").notNull(),
  ownerId: uuid("owner_id"),
  source: text("source"),
  destination: text("destination"),
  product: text("product"),
  travelStart: date("travel_start"),
  travelEnd: date("travel_end"),
  dateFlexibility: text("date_flexibility"),
  travelers: integer("travelers"),
  // numeric llega como texto: nunca se convierte a número de coma flotante.
  budgetAmount: numeric("budget_amount", { precision: 14, scale: 2 }),
  budgetCurrency: currencyCode("budget_currency"),
  priority: priority("priority").notNull().default("media"),
  notes: text("notes"),
  lostReason: lossReason("lost_reason"),
  lostNote: text("lost_note"),
  wonEvidence: text("won_evidence"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  opportunityId: uuid("opportunity_id"),
  kind: taskKind("kind").notNull(),
  title: text("title").notNull(),
  assigneeId: uuid("assignee_id").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  priority: priority("priority").notNull().default("media"),
  status: taskStatus("status").notNull().default("abierta"),
  result: text("result"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  opportunityId: uuid("opportunity_id"),
  kind: text("kind").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  actorId: uuid("actor_id").notNull(),
  createdAt: createdAt(),
});

export const schemaTables = {
  agencies,
  memberships,
  invitations,
  audit_events: auditEvents,
  pipeline_stages: pipelineStages,
  contacts,
  contact_phones: contactPhones,
  contact_emails: contactEmails,
  contact_consents: contactConsents,
  opportunities,
  tasks,
  activities,
};
