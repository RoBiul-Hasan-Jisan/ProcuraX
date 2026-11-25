/**
 * Builds a CSV string. Cells that start with = + - @ (or tab / CR) are prefixed with a quote so a spreadsheet cannot run them
 * as formulas. Numbers given as strings are left alone apart from that rule, except a plain leading minus on a real number.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    const isNumber = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s);
    if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
