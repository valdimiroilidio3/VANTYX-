"use client";

/**
 * Etiquetas — impressão de etiquetas de gôndola/prateleira com código de
 * barras EAN-13 real (renderizado localmente, sem dependências externas).
 */

import { useEffect, useMemo, useState } from "react";
import { Printer, Search, Tag } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtMoney } from "@/lib/format";
import { ean13Bars, isValidEan13 } from "@/lib/domain/ean13";

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  base_price_cents: number;
  unit: string;
}

interface BarcodeRow {
  product_id: string;
  code: string;
}

interface LabelDraft {
  key: string;
  productId: string;
  name: string;
  priceCents: number;
  unit: string;
  barcode: string | null;
  copies: number;
}

interface PrintableLabel extends LabelDraft {
  skuFallback: string;
}

function BarcodeSvg({ code, height = 34 }: { code: string; height?: number }) {
  const bars = useMemo(() => ean13Bars(code), [code]);
  if (!bars) return null;
  const width = 95;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Código de barras ${code}`}
      preserveAspectRatio="none"
      style={{ height }}
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.width} height={height - 8} fill="#000" />
      ))}
      <text x={width / 2} y={height - 1} textAnchor="middle" fontSize="6" fontFamily="monospace" fill="#000">
        {code}
      </text>
    </svg>
  );
}

function printLabels(labels: PrintableLabel[], size: string, orgName: string, currency: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const labelCss =
    size === "small"
      ? "width:48mm;height:25mm;padding:1.5mm;font-size:7px"
      : "width:60mm;height:34mm;padding:2mm;font-size:8px";
  const items = labels
    .flatMap((l) =>
      Array.from({ length: l.copies }, () => `
      <div class="label">
        <div class="org">${esc(orgName)}</div>
        <div class="name">${esc(l.name)}</div>
        <div class="price">${(l.priceCents / 100).toFixed(2).replace(".", ",")} ${esc(currency)}${l.unit !== "un" ? "/" + esc(l.unit) : ""}</div>
        ${l.barcode ? `<div class="bc">${barcodeSvgString(l.barcode)}</div>` : `<div class="sku">SKU ${esc(l.skuFallback ?? "")}</div>`}
      </div>`),
    )
    .join("");
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas VANTYX</title><style>
    @page { margin: 4mm; }
    body { font-family: Arial, sans-serif; margin: 0; display: flex; flex-wrap: wrap; gap: 2mm; }
    .label { ${labelCss}; box-sizing: border-box; border: 1px dashed #bbb; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; break-inside: avoid; }
    .org { font-size: 0.75em; color: #555; white-space: nowrap; overflow: hidden; }
    .name { font-weight: bold; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
    .price { font-size: 1.5em; font-weight: 800; }
    .bc svg { width: 100%; height: 14mm; display: block; }
    .sku { font-family: monospace; font-size: 0.8em; text-align: center; }
  </style></head><body>${items}</body></html>`);
  doc.close();
  const go = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  };
  iframe.onload = go;
  setTimeout(go, 500);
}

function barcodeSvgString(code: string): string {
  const bars = ean13Bars(code);
  if (!bars) return "";
  const rects = bars.map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="26" fill="#000"/>`).join("");
  return `<svg viewBox="0 0 95 34" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}<text x="47.5" y="33" text-anchor="middle" font-size="6" font-family="monospace" fill="#000">${code}</text></svg>`;
}

export default function LabelsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const currency = workspace.org.currency;

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [barcodes, setBarcodes] = useState<BarcodeRow[]>([]);
  const [drafts, setDrafts] = useState<LabelDraft[]>([]);
  const [size, setSize] = useState("small");
  const [copies, setCopies] = useState("4");

  useEffect(() => {
    const q = search.trim();
    const h = setTimeout(() => {
      api<{ rows: ProductRow[]; total: number }>("/api/products", {
        query: { search: q || undefined, status: "active", limit: 30 },
      })
        .then((d) => setProducts(d.rows))
        .catch(() => setProducts([]));
    }, 250);
    return () => clearTimeout(h);
  }, [search]);

  useEffect(() => {
    // Barcode lookup endpoint: product detail per selected product
    const ids = drafts.map((d) => d.productId);
    if (!ids.length) return;
    let alive = true;
    (async () => {
      const rows: BarcodeRow[] = [];
      for (const id of ids) {
        if (barcodes.some((b) => b.product_id === id)) continue;
        try {
          const d = await api<{ barcodes?: { code: string }[] }>(`/api/products/${id}`);
          for (const b of d.barcodes ?? []) rows.push({ product_id: id, code: b.code });
        } catch {
          /* produto sem barcode — etiqueta imprime SKU */
        }
      }
      if (alive && rows.length) setBarcodes((list) => [...list, ...rows]);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length]);

  function addLabel(p: ProductRow) {
    if (drafts.some((d) => d.productId === p.id)) {
      setDrafts((list) => list.map((d) => (d.productId === p.id ? { ...d, copies: d.copies + 1 } : d)));
      return;
    }
    setDrafts((list) => [
      ...list,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        name: p.name,
        priceCents: p.base_price_cents,
        unit: p.unit,
        barcode: null,
        copies: Math.max(1, parseInt(copies) || 1),
      },
    ]);
  }

  const printable = drafts.map((d) => ({
    ...d,
    barcode: barcodes.find((b) => b.product_id === d.productId && isValidEan13(b.code))?.code ?? null,
    skuFallback: products.find((p) => p.id === d.productId)?.sku ?? d.productId,
  }));

  return (
    <>
      <PageHeader
        title="Etiquetas de produto"
        subtitle="Impressão de etiquetas com EAN-13 real para gôndola e balança"
        actions={
          <>
            <Select className="w-auto" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Tamanho">
              <option value="small">48×25 mm</option>
              <option value="large">60×34 mm</option>
            </Select>
            <Button
              variant="accent"
              size="sm"
              disabled={!drafts.length}
              onClick={() => {
                printLabels(printable, size, workspace.org.name, currency);
                toast.info("A enviar para impressão…");
              }}
              icon={<Printer className="h-3.5 w-3.5" />}
            >
              Imprimir ({printable.reduce((a, l) => a + l.copies, 0)})
            </Button>
          </>
        }
      />

      <div className="grid gap-3 p-3 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
            <Input className="pl-8" placeholder="Pesquisar produto…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => addLabel(p)}
                className="rounded-lg border border-mist-200 bg-white p-2.5 text-left hover:border-lime-brand dark:border-graphite-600 dark:bg-graphite-850"
              >
                <span className="block truncate text-xs font-semibold">{p.name}</span>
                <span className="mt-1 block font-mono text-sm font-bold text-lime-dim dark:text-lime-brand">
                  {fmtMoney(p.base_price_cents, currency)}
                </span>
                <span className="block font-mono text-[10px] text-graphite-400">{p.sku}</span>
              </button>
            ))}
          </div>
          {!products.length && (
            <EmptyState title="Pesquise produtos" message="Clique num produto para adicionar etiquetas à folha." icon={<Tag className="h-8 w-8" />} />
          )}
        </div>

        <div className="card flex flex-col p-3">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-graphite-400">Folha de etiquetas</h2>
            <div className="ml-auto flex items-center gap-2">
              <Field label="">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  className="h-7 w-16 text-xs"
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                  aria-label="Cópias por produto"
                />
              </Field>
              {drafts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setDrafts([])}>
                  Limpar
                </Button>
              )}
            </div>
          </div>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {printable.map((l) => (
              <li key={l.key} className="rounded-lg border border-mist-200 p-2 dark:border-graphite-600">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{l.name}</span>
                    <span className="block font-mono text-[11px] font-bold">{fmtMoney(l.priceCents, currency)}</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    className="w-12 rounded border border-mist-200 bg-transparent px-1 py-0.5 text-center text-xs dark:border-graphite-600"
                    value={l.copies}
                    onChange={(e) =>
                      setDrafts((list) =>
                        list.map((d) => (d.key === l.key ? { ...d, copies: Math.max(1, parseInt(e.target.value) || 1) } : d)),
                      )
                    }
                    aria-label={`Cópias de ${l.name}`}
                  />
                  <button
                    className="rounded p-1 text-graphite-400 hover:text-danger"
                    onClick={() => setDrafts((list) => list.filter((d) => d.key !== l.key))}
                    aria-label="Remover etiqueta"
                  >
                    ✕
                  </button>
                </div>
                {l.barcode ? (
                  <div className="mt-1.5">
                    <BarcodeSvg code={l.barcode} height={30} />
                  </div>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-warning">
                    <Badge tone="warning">sem EAN-13</Badge> etiqueta imprime SKU {l.skuFallback}
                  </p>
                )}
              </li>
            ))}
            {!drafts.length && (
              <li className="py-8 text-center text-[11px] text-graphite-400">
                Adicione produtos à esquerda.
                <br />
                Códigos EAN-13 inválidos são detetados e a etiqueta cai para SKU.
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
