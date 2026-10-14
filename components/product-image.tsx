"use client";

import Image from "next/image";
import { clsx } from "clsx";

/**
 * Product thumbnail: uses the real photo when the catalog provides one,
 * otherwise renders a deterministic vibrant gradient monogram so grids
 * always look alive (no broken/empty squares).
 */

const GRADIENTS: [string, string][] = [
  ["#b9ff00", "#22c55e"],
  ["#38bdf8", "#818cf8"],
  ["#f472b6", "#fb7185"],
  ["#fbbf24", "#fb923c"],
  ["#34d399", "#22d3ee"],
  ["#a78bfa", "#e879f9"],
  ["#4ade80", "#a3e635"],
  ["#60a5fa", "#38bdf8"],
];

function gradientFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length]!;
}

export function ProductImage({
  src,
  name,
  className,
  rounded = "rounded-xl",
}: {
  src?: string | null;
  name: string;
  className?: string;
  rounded?: string;
}) {
  const box = clsx("relative shrink-0 overflow-hidden", rounded, className);
  if (src) {
    return (
      <span className={box}>
        <Image src={src} alt={name} fill sizes="160px" className="object-cover" />
      </span>
    );
  }
  const [from, to] = gradientFor(name);
  const letter = (name.trim()[0] ?? "•").toUpperCase();
  return (
    <span
      className={clsx(box, "@container flex items-center justify-center")}
      style={{ backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden
    >
      <span className="font-mono text-[42cqw] leading-none font-black text-white/90 drop-shadow-sm">
        {letter}
      </span>
    </span>
  );
}
