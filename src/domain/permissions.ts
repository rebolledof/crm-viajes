/**
 * Roles y permisos del MVP (SPEC-000 RF-03). La base de datos aplica las mismas reglas con RLS;
 * este módulo decide qué ofrece la interfaz y valida en servidor antes de llamar a la base.
 */
export const ROLES = ["admin", "asesor", "lectura"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  asesor: "Asesor",
  lectura: "Solo lectura",
};

const PERMISSIONS = {
  "agency.update": ["admin"],
  "team.manage": ["admin"],
  "audit.read": ["admin"],
  "pipeline.manage": ["admin"],
  "crm.write": ["admin", "asesor"],
  "crm.read": ["admin", "asesor", "lectura"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
