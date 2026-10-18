import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mergeFiles, parseCsv, parseLetterboxdFile } from "@/lib/letterboxd";
import { readCsvFromZip } from "@/lib/zip";

const watched = `Date,Name,Year,Letterboxd URI
2021-02-03,Dune,2021,https://boxd.it/a
2020-01-01,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/b
2019-05-05,"Say ""Hi""",2019,https://boxd.it/c
`;
const ratings = `Date,Name,Year,Letterboxd URI,Rating
2021-02-04,Dune,2021,https://boxd.it/a,4.5
2022-03-03,Heat,1995,https://boxd.it/d,3
`;
const watchlist = `Date,Name,Year,Letterboxd URI
2023-01-01,Heat,1995,https://boxd.it/d
2023-01-01,Stalker,1979,https://boxd.it/e
`;

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b,c","d ""e"""\r\n1,2,3\r\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
  it("keeps line breaks inside quotes", () => {
    expect(parseCsv('a,"x\ny"\n')).toEqual([["a", "x\ny"]]);
  });
});

describe("parseLetterboxdFile", () => {
  it("reads watched, ratings and watchlist by columns and file name", () => {
    expect(parseLetterboxdFile("watched.csv", watched)?.kind).toBe("watched");
    expect(parseLetterboxdFile("ratings.csv", ratings)?.rows[0]).toMatchObject({ name: "Dune", ratingHalf: 9, watched: "2021-02-04" });
    const wl = parseLetterboxdFile("watchlist.csv", watchlist)!;
    expect(wl.kind).toBe("watchlist");
    expect(wl.rows.every((r) => r.watchlist && r.watched === null)).toBe(true);
  });
  it("ignores files it does not know", () => {
    expect(parseLetterboxdFile("profile.csv", "Date Joined,Username\n2020-01-01,x\n")).toBeNull();
  });
  it("reads quoted titles", () => {
    const names = parseLetterboxdFile("watched.csv", watched)!.rows.map((r) => r.name);
    expect(names).toEqual(["Dune", "Crouching Tiger, Hidden Dragon", 'Say "Hi"']);
  });
});

describe("mergeFiles", () => {
  const rows = mergeFiles(["watched.csv", "ratings.csv", "watchlist.csv"].map((n, i) => parseLetterboxdFile(n, [watched, ratings, watchlist][i])!));
  const by = (name: string) => rows.find((r) => r.name === name)!;
  it("gives one row per film with rating and latest date", () => {
    expect(rows.filter((r) => r.name === "Dune")).toHaveLength(1);
    expect(by("Dune")).toMatchObject({ ratingHalf: 9, watched: "2021-02-04", watchlist: false });
  });
  it("treats a rated film as watched, and watched beats watchlist", () => {
    expect(by("Heat")).toMatchObject({ ratingHalf: 6, watchlist: false });
  });
  it("keeps watchlist-only films as want-to", () => {
    expect(by("Stalker")).toMatchObject({ watchlist: true, watched: null });
  });
});

function zipOf(files: Record<string, { data: string; deflate: boolean }>): ArrayBuffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, f] of Object.entries(files)) {
    const raw = Buffer.from(f.data);
    const body = f.deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(f.deflate ? 8 : 0, 10);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    parts.push(local, nameBuf, body);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

describe("readCsvFromZip", () => {
  it("reads stored and deflated csv files and skips others", async () => {
    const zip = zipOf({ "watched.csv": { data: watched, deflate: true }, "ratings.csv": { data: ratings, deflate: false }, "notes.txt": { data: "x", deflate: false } });
    const out = await readCsvFromZip(zip);
    expect(Object.keys(out).sort()).toEqual(["ratings.csv", "watched.csv"]);
    expect(out["watched.csv"]).toBe(watched);
  });
  it("rejects something that is not a zip", async () => {
    await expect(readCsvFromZip(new TextEncoder().encode("hello world, not a zip file at all").buffer as ArrayBuffer)).rejects.toThrow();
  });
});
