// SPEC-000 RF-01, RF-02, RF-03, RF-14 · Criterios AC-01 y AC-08 · Briefing 5.3
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../../src/db/client";
import { agencies, auditEvents, invitations, memberships } from "../../src/db/schema";
import {
  acceptInvitation,
  changeMemberRole,
  createAgency,
  createInvitation,
  listAudit,
  listMyMemberships,
  renameAgency,
  revokeInvitation,
  revokeMembership,
} from "../../src/server/agencies";
import { AppError } from "../../src/server/errors";
import { as, createUser, testDb } from "./helpers";

const t = testDb();
let adminA: SessionUser, adminB: SessionUser, asesorA: SessionUser, lecturaA: SessionUser, outsider: SessionUser;
let agencyA: string, agencyB: string;

async function invite(by: SessionUser, agencyId: string, to: SessionUser, role: "admin" | "asesor" | "lectura") {
  return as(t.db, by, (tx) => createInvitation(tx, { userId: by.id, agencyId, email: to.email, role, now: new Date() }));
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  adminA = await createUser(t.admin, "admin-a");
  adminB = await createUser(t.admin, "admin-b");
  asesorA = await createUser(t.admin, "asesor-a");
  lecturaA = await createUser(t.admin, "lectura-a");
  outsider = await createUser(t.admin, "fuera");
  agencyA = await as(t.db, adminA, (tx) => createAgency(tx, "Viajes Andes"));
  agencyB = await as(t.db, adminB, (tx) => createAgency(tx, "Caribe Tours"));
  const ia = await invite(adminA, agencyA, asesorA, "asesor");
  await as(t.db, asesorA, (tx) => acceptInvitation(tx, ia.token));
  const il = await invite(adminA, agencyA, lecturaA, "lectura");
  await as(t.db, lecturaA, (tx) => acceptInvitation(tx, il.token));
});

afterAll(() => t.close());

describe("aislamiento entre agencias (AC-01)", () => {
  it("cada usuario solo ve su propia agencia", async () => {
    const seenByA = await as(t.db, adminA, (tx) => tx.select().from(agencies));
    expect(seenByA.map((a) => a.id)).toEqual([agencyA]);
    const seenByB = await as(t.db, adminB, (tx) => tx.select().from(agencies));
    expect(seenByB.map((a) => a.id)).toEqual([agencyB]);
  });

  it("pedir por ID registros de otra agencia no devuelve nada", async () => {
    const res = await as(t.db, adminA, async (tx) => ({
      agency: await tx.select().from(agencies).where(eq(agencies.id, agencyB)),
      members: await tx.select().from(memberships).where(eq(memberships.agencyId, agencyB)),
      invites: await tx.select().from(invitations).where(eq(invitations.agencyId, agencyB)),
      audit: await tx.select().from(auditEvents).where(eq(auditEvents.agencyId, agencyB)),
    }));
    expect(res).toEqual({ agency: [], members: [], invites: [], audit: [] });
  });

  it("un admin de A no puede modificar la agencia B, ni con SQL directo", async () => {
    await expectCode(as(t.db, adminA, (tx) => renameAgency(tx, adminA.id, agencyB, "Hackeada")), "not_found");
    const touched = await as(t.db, adminA, (tx) =>
      tx.update(agencies).set({ name: "Hackeada" }).where(eq(agencies.id, agencyB)).returning(),
    );
    expect(touched).toEqual([]);
    const [b] = await t.admin`select name from public.agencies where id = ${agencyB}`;
    expect(b.name).toBe("Caribe Tours");
  });

  it("un admin de A no puede crear invitaciones ni auditoría en B", async () => {
    await expectCode(invite(adminA, agencyB, outsider, "admin"), "not_found");
    await expect(
      as(t.db, adminA, (tx) =>
        tx.insert(invitations).values({ agencyId: agencyB, email: outsider.email, role: "admin", tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 86_400_000), invitedBy: adminA.id }),
      ),
    ).rejects.toThrow();
    await expect(
      as(t.db, adminA, (tx) => tx.insert(auditEvents).values({ agencyId: agencyB, actorId: adminA.id, action: "x.y", objectType: "x" })),
    ).rejects.toThrow();
  });

  it("no se puede escribir auditoría a nombre de otra persona", async () => {
    await expect(
      as(t.db, asesorA, (tx) => tx.insert(auditEvents).values({ agencyId: agencyA, actorId: adminA.id, action: "x.y", objectType: "x" })),
    ).rejects.toThrow();
  });

  it("sin sesión no hay acceso a las tablas", async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await tx.execute(sql`set local role anon`);
        return tx.execute(sql`select count(*) from public.agencies`);
      }),
    ).rejects.toSatisfy((e: unknown) => /permission denied/.test(String((e as { cause?: unknown }).cause)));
  });

  it("autenticado pero sin membresía no ve agencias", async () => {
    expect(await as(t.db, outsider, (tx) => tx.select().from(agencies))).toEqual([]);
  });
});

describe("roles (RF-03)", () => {
  it("asesor y lectura no gestionan el equipo ni la agencia", async () => {
    for (const u of [asesorA, lecturaA]) {
      await expectCode(invite(u, agencyA, outsider, "admin"), "permission_denied");
      await expectCode(as(t.db, u, (tx) => renameAgency(tx, u.id, agencyA, "Otro")), "permission_denied");
      await expectCode(as(t.db, u, (tx) => listAudit(tx, u.id, agencyA)), "permission_denied");
      const touched = await as(t.db, u, (tx) => tx.update(agencies).set({ name: "Otro" }).where(eq(agencies.id, agencyA)).returning());
      expect(touched).toEqual([]);
      const promoted = await as(t.db, u, (tx) => tx.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, u.id)).returning());
      expect(promoted).toEqual([]);
    }
  });

  it("asesor ve la agencia y a sus compañeros", async () => {
    const mine = await as(t.db, asesorA, (tx) => listMyMemberships(tx, asesorA.id));
    expect(mine).toEqual([{ agencyId: agencyA, agencyName: "Viajes Andes", role: "asesor" }]);
  });

  it("un admin no puede quitarse su propio rol", async () => {
    await expectCode(as(t.db, adminA, (tx) => changeMemberRole(tx, adminA.id, agencyA, adminA.id, "lectura")), "permission_denied");
    const self = await as(t.db, adminA, (tx) => tx.update(memberships).set({ role: "lectura" }).where(eq(memberships.userId, adminA.id)).returning());
    expect(self).toEqual([]);
  });
});

describe("invitaciones (RF-02, AC-08)", () => {
  it("una invitación vencida se rechaza", async () => {
    const u = await createUser(t.admin, "vencida");
    const { id, token } = await invite(adminA, agencyA, u, "asesor");
    await t.admin`update public.invitations set expires_at = now() - interval '1 second' where id = ${id}`;
    await expectCode(as(t.db, u, (tx) => acceptInvitation(tx, token)), "invitation_invalid");
  });

  it("una invitación revocada se rechaza", async () => {
    const u = await createUser(t.admin, "revocada");
    const { id, token } = await invite(adminA, agencyA, u, "asesor");
    await as(t.db, adminA, (tx) => revokeInvitation(tx, adminA.id, agencyA, id));
    await expectCode(as(t.db, u, (tx) => acceptInvitation(tx, token)), "invitation_invalid");
  });

  it("no la puede usar otro correo ni reutilizarse", async () => {
    const u = await createUser(t.admin, "invitado");
    const { token } = await invite(adminA, agencyA, u, "lectura");
    await expectCode(as(t.db, outsider, (tx) => acceptInvitation(tx, token)), "invitation_invalid");
    await as(t.db, u, (tx) => acceptInvitation(tx, token));
    await expectCode(as(t.db, u, (tx) => acceptInvitation(tx, token)), "invitation_invalid");
    const mine = await as(t.db, u, (tx) => listMyMemberships(tx, u.id));
    expect(mine.map((m) => m.role)).toEqual(["lectura"]);
  });

  it("un token inventado se rechaza", async () => {
    await expectCode(as(t.db, outsider, (tx) => acceptInvitation(tx, "token-inventado")), "invitation_invalid");
  });

  it("el hash de la aplicación coincide con el de la base", async () => {
    const { hashInvitationToken } = await import("../../src/domain/invitations");
    const [r] = await t.admin`select encode(sha256(convert_to('ñandú-token', 'UTF8')), 'hex') as h`;
    expect(r.h).toBe(hashInvitationToken("ñandú-token"));
  });
});

describe("revocar acceso", () => {
  it("una membresía revocada deja de autorizar operaciones", async () => {
    const u = await createUser(t.admin, "saliente");
    const { token } = await invite(adminA, agencyA, u, "asesor");
    await as(t.db, u, (tx) => acceptInvitation(tx, token));
    expect(await as(t.db, u, (tx) => tx.select().from(agencies))).toHaveLength(1);
    await as(t.db, adminA, (tx) => revokeMembership(tx, adminA.id, agencyA, u.id));
    expect(await as(t.db, u, (tx) => tx.select().from(agencies))).toEqual([]);
    expect(await as(t.db, u, (tx) => listMyMemberships(tx, u.id))).toEqual([]);
  });
});

describe("auditoría (RF-14)", () => {
  it("registra la creación de la agencia, invitaciones y aceptaciones", async () => {
    const events = await as(t.db, adminA, (tx) => listAudit(tx, adminA.id, agencyA, 200));
    const actions = new Set(events.map((e) => e.action));
    for (const a of ["agency.created", "invitation.created", "invitation.accepted", "invitation.revoked", "membership.revoked"]) {
      expect(actions).toContain(a);
    }
    expect(events.every((e) => e.agencyId === agencyA)).toBe(true);
  });

  it("un nombre repetido devuelve un error claro", async () => {
    await expectCode(as(t.db, outsider, (tx) => createAgency(tx, "Viajes Andes")), "slug_taken");
  });
});
