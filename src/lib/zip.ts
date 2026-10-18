// A minimal zip reader, enough for the Letterboxd export (stored or deflated files). Works in the browser and Node.

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns the text of every `.csv` file in the zip, keyed by its path. Throws if the file is not a readable zip. */
export async function readCsvFromZip(buffer: ArrayBuffer): Promise<Record<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const out: Record<string, string> = {};
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) throw new Error("Bad zip");
    const method = u16(view, p + 10);
    const size = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(".csv") || name.endsWith("/")) continue;
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) continue;
    out[name] = new TextDecoder().decode(method === 8 ? await inflate(raw) : raw);
  }
  return out;
}
