"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * QR Code renderer (SVG puro, sem assets externos).
 * Especificações AT (Portaria 195/2020): ECC 'M', modo Byte, versão mínima 9
 * (53×53 módulos) e margem silenciosa de 4 módulos.
 */

function buildMatrix(text: string) {
  let q = qrcode(0, "M"); // 0 = auto-version
  q.addData(text, "Byte");
  q.make();
  if (q.getModuleCount() < 53) {
    q = qrcode(9, "M"); // versão mínima exigida pela AT
    q.addData(text, "Byte");
    q.make();
  }
  return q;
}

/** SVG em string (usado na impressão do talão via iframe). */
export function qrSvgString(text: string, px = 240): string {
  const q = buildMatrix(text);
  const count = q.getModuleCount();
  const margin = 4;
  const total = count + margin * 2;
  const unit = px / total;
  let cells = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (q.isDark(r, c)) {
        const x = ((c + margin) * unit).toFixed(2);
        const y = ((r + margin) * unit).toFixed(2);
        cells += `<rect x="${x}" y="${y}" width="${(unit + 0.06).toFixed(2)}" height="${(unit + 0.06).toFixed(2)}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges"><rect width="${px}" height="${px}" fill="#ffffff"/><g fill="#000000">${cells}</g></svg>`;
}

export function QrCode({
  text,
  size = 140,
  className,
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  const { count, dark } = useMemo(() => {
    const q = buildMatrix(text);
    const n = q.getModuleCount();
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
      cells.push(row);
    }
    return { count: n, dark: cells };
  }, [text]);

  const margin = 4;
  const total = count + margin * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Código QR do documento"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <g fill="#000000">
        {dark.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c + margin} y={r + margin} width={1.02} height={1.02} /> : null,
          ),
        )}
      </g>
    </svg>
  );
}
