/** Convierte el nombre de la agencia en un identificador para URLs: minúsculas, sin tildes, con guiones. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function isValidAgencyName(name: string): boolean {
  const n = name.trim().length;
  return n >= 2 && n <= 120;
}
