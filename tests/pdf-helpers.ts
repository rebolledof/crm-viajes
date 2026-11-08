// Ayudas de prueba para el PDF del cotizador: leer el texto de un PDF de pdf-lib y crear un PNG mínimo.
import { deflateSync, inflateSync } from "node:zlib";

/** Texto de un PDF hecho con pdf-lib: descomprime cada stream y junta las cadenas de Tj. */
export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let body = m[1];
    try {
      body = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      // Stream sin comprimir.
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG de 2×2 píxeles de un color (para probar el logo congelado). */
export function tinyPng(r: number, g: number, b: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const row = Buffer.from([0, r, g, b, r, g, b]);
  const idat = deflateSync(Buffer.concat([row, row]));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
}
