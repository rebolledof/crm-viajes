import { describe, expect, it } from "vitest";
import { isValidAgencyName, slugify } from "@/domain/agency";
import {
  INVITATION_TTL_DAYS,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  invitationStatus,
  normalizeEmail,
} from "@/domain/invitations";
import { ROLES, can, isRole } from "@/domain/permissions";
import { safeNext } from "@/lib/supabase/env";

describe("permisos por rol (RF-03)", () => {
  it("solo admin gestiona equipo, agencia y auditoría", () => {
    for (const p of ["team.manage", "agency.update", "audit.read"] as const) {
      expect(can("admin", p)).toBe(true);
      expect(can("asesor", p)).toBe(false);
      expect(can("lectura", p)).toBe(false);
    }
  });
  it("lectura consulta el CRM pero no escribe", () => {
    expect(can("lectura", "crm.read")).toBe(true);
    expect(can("lectura", "crm.write")).toBe(false);
    expect(can("asesor", "crm.write")).toBe(true);
  });
  it("sin rol no hay permisos", () => {
    expect(can(null, "crm.read")).toBe(false);
    expect(can(undefined, "crm.read")).toBe(false);
  });
  it("reconoce solo los roles definidos", () => {
    expect(ROLES).toEqual(["admin", "asesor", "lectura"]);
    expect(isRole("asesor")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});

describe("invitaciones (RF-02, AC-08)", () => {
  const now = new Date("2026-11-02T15:00:00Z");

  it("vencen a los 7 días", () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    expect(invitationExpiresAt(now).toISOString()).toBe("2026-11-09T15:00:00.000Z");
  });
  it("calcula el estado con prioridad revocada > aceptada > vencida > pendiente", () => {
    const expiresAt = invitationExpiresAt(now);
    const day8 = new Date("2026-11-10T15:00:00Z");
    expect(invitationStatus({ expiresAt, acceptedAt: null, revokedAt: null }, now)).toBe("pendiente");
    expect(invitationStatus({ expiresAt, acceptedAt: null, revokedAt: null }, day8)).toBe("vencida");
    expect(invitationStatus({ expiresAt, acceptedAt: now, revokedAt: null }, day8)).toBe("aceptada");
    expect(invitationStatus({ expiresAt, acceptedAt: now, revokedAt: now }, now)).toBe("revocada");
  });
  it("vence justo en el instante límite", () => {
    const expiresAt = invitationExpiresAt(now);
    expect(invitationStatus({ expiresAt, acceptedAt: null, revokedAt: null }, expiresAt)).toBe("vencida");
  });
  it("genera tokens distintos y difíciles de adivinar", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("hashea con SHA-256 en hexadecimal", () => {
    expect(hashInvitationToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("normaliza el correo", () => {
    expect(normalizeEmail("  Ana@Agencia.COM ")).toBe("ana@agencia.com");
  });
});

describe("agencia", () => {
  it("convierte el nombre en un slug sin tildes", () => {
    expect(slugify("Viajes Ñandú & Más")).toBe("viajes-nandu-mas");
    expect(slugify("  --Agencia   Bogotá--  ")).toBe("agencia-bogota");
    expect(slugify("¡¡!!")).toBe("");
  });
  it("limita el slug a 60 caracteres sin guion final", () => {
    const s = slugify("a".repeat(59) + " bcd");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
  it("valida el largo del nombre", () => {
    expect(isValidAgencyName("A")).toBe(false);
    expect(isValidAgencyName("  AB  ")).toBe(true);
    expect(isValidAgencyName("x".repeat(121))).toBe(false);
  });
});

describe("redirecciones seguras", () => {
  it("solo acepta rutas internas", () => {
    expect(safeNext("/app/equipo")).toBe("/app/equipo");
    expect(safeNext("//evil.com")).toBe("/app");
    expect(safeNext("/\\evil.com")).toBe("/app");
    expect(safeNext("https://evil.com")).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
  });
});
