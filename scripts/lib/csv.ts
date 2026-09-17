/** Minimal RFC-4180 line splitter shared by the build scripts. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface Table {
  header: string[];
  rows: string[][];
  index: (name: string) => number;
}

export async function readCsv(path: string, encoding: "utf-8" | "latin1" = "utf-8"): Promise<Table> {
  const buf = await Bun.file(path).arrayBuffer();
  const text = new TextDecoder(encoding === "latin1" ? "windows-1252" : "utf-8")
    .decode(buf)
    .replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "");
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    rows.push(splitCsvLine(lines[i]!));
  }
  const lookup = new Map(header.map((h, i) => [h.trim(), i]));
  return {
    header,
    rows,
    index: (name) => {
      const i = lookup.get(name);
      if (i === undefined) throw new Error(`Missing column "${name}" in ${path}`);
      return i;
    },
  };
}
