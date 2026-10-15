"use client";

import { Printer, RotateCcw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { QrCode, qrSvgString } from "@/components/qr-code";

export interface ReceiptVM {
  orgName: string;
  orgTaxId: string | null;
  header: string | null;
  footer: string | null;
  documentNumber: string | null;
  date: string;
  lines: { name: string; variant: string | null; qty: number; unit: string; unitPrice: number; total: number }[];
  totals: { subtotal: number; discount: number; tax: number; total: number; paid: number; change: number };
  payments: { method: string; amount: number }[];
  hash: string;
  hash4?: string;
  hashControl?: string | null;
  atcud?: string | null;
  qr?: string | null;
  certified?: boolean;
  currency: string;
  status: string;
  fiscalNotice?: string;
}

/** Prints an 80mm-style receipt through a hidden iframe (no popups). */
function printReceipt(vm: ReceiptVM) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  doc.open();
  doc.write(`<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>${esc(vm.documentNumber ?? "Talão")}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Courier New", monospace; width: 72mm; margin: 0 auto; color: #000; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .sm { font-size: 9px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  td { padding: 1px 0; vertical-align: top; }
  .r { text-align: right; } .b { font-weight: bold; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .tot td { padding: 1px 0; }
</style></head><body>
<h1>${esc(vm.orgName)}</h1>
${vm.orgTaxId ? `<p class="c sm">NIF: ${esc(vm.orgTaxId)}</p>` : ""}
${vm.header ? `<p class="c sm">${esc(vm.header)}</p>` : ""}
<hr/>
<p class="c b">${esc(vm.documentNumber ?? "DOCUMENTO INTERNO")}</p>
<p class="c sm">${esc(new Date(vm.date).toLocaleString("pt-PT"))}</p>
<hr/>
<table>
${vm.lines
  .map(
    (l) => `<tr><td>${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ""}<br/><span class="sm">${l.qty
      .toString()
      .replace(".", ",")} ${esc(l.unit)} × ${(l.unitPrice / 100).toFixed(2).replace(".", ",")}</span></td><td class="r">${(l.total / 100)
      .toFixed(2)
      .replace(".", ",")}</td></tr>`,
  )
  .join("")}
</table>
<hr/>
<table class="tot">
<tr><td>Subtotal</td><td class="r">${(vm.totals.subtotal / 100).toFixed(2)}</td></tr>
${vm.totals.discount ? `<tr><td>Desconto</td><td class="r">-${(vm.totals.discount / 100).toFixed(2)}</td></tr>` : ""}
<tr><td>IVA incluído</td><td class="r">${(vm.totals.tax / 100).toFixed(2)}</td></tr>
<tr class="b"><td>TOTAL</td><td class="r">${(vm.totals.total / 100).toFixed(2)} ${esc(vm.currency)}</td></tr>
${vm.payments.map((p) => `<tr><td>${esc(p.method)}</td><td class="r">${(p.amount / 100).toFixed(2)}</td></tr>`).join("")}
${vm.totals.change ? `<tr><td>Troco</td><td class="r">${(vm.totals.change / 100).toFixed(2)}</td></tr>` : ""}
</table>
<hr/>
${vm.qr ? `<div class="c" style="margin:6px 0">${qrSvgString(vm.qr, 200)}</div>` : ""}
${vm.atcud ? `<p class="c sm b">ATCUD: ${esc(vm.atcud)}</p>` : ""}
${vm.certified ? `<p class="sm c">Processado por programa certificado n.º ${esc(String(vm.hashControl ?? "").split(".")[0] ?? "")}/AT</p>` : ""}
${vm.fiscalNotice ? `<p class="sm c">${esc(vm.fiscalNotice)}</p>` : ""}
<p class="sm c">Hash: ${esc(vm.hash4 || vm.hash.slice(0, 4))}</p>
<p class="c sm">${esc(vm.footer ?? "")}</p>
</body></html>`);
  doc.close();
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  };
  // Fallback if onload already fired
  setTimeout(() => {
    if (iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 2000);
    }
  }, 400);
}

export function ReceiptModal({
  vm,
  onClose,
  onNewSale,
  canReprint,
}: {
  vm: ReceiptVM | null;
  onClose: () => void;
  onNewSale: () => void;
  canReprint: boolean;
}) {
  if (!vm) return null;
  return (
    <Modal open onClose={onClose} title={`Venda concluída — ${vm.documentNumber ?? "documento interno"}`}>
      <div className="space-y-4">
        <div className="rounded-lg bg-mist-100 p-4 font-mono text-xs dark:bg-graphite-800">
          <p className="text-center font-bold">{vm.orgName}</p>
          <p className="text-center text-[10px] text-graphite-400">
            {vm.documentNumber} · {new Date(vm.date).toLocaleString("pt-PT")}
          </p>
          <hr className="my-2 border-dashed border-graphite-300 dark:border-graphite-600" />
          <ul className="space-y-1">
            {vm.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">
                    {l.qty.toString().replace(".", ",")} {l.unit === "un" ? "" : l.unit} {l.name}
                    {l.variant ? ` (${l.variant})` : ""}
                  </span>
                  <span className="block text-[10px] text-graphite-400">
                    {fmtMoney(l.unitPrice, vm.currency)} × {l.qty.toString().replace(".", ",")}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{fmtMoney(l.total, vm.currency)}</span>
              </li>
            ))}
          </ul>
          <hr className="my-2 border-dashed border-graphite-300 dark:border-graphite-600" />
          <div className="space-y-0.5">
            {vm.totals.discount > 0 && (
              <p className="flex justify-between"><span>Desconto</span><span>−{fmtMoney(vm.totals.discount, vm.currency)}</span></p>
            )}
            <p className="flex justify-between"><span>IVA incluído</span><span>{fmtMoney(vm.totals.tax, vm.currency)}</span></p>
            <p className="flex justify-between text-sm font-bold">
              <span>TOTAL</span><span>{fmtMoney(vm.totals.total, vm.currency)}</span>
            </p>
            {vm.totals.change > 0 && (
              <p className="flex justify-between"><span>Troco</span><span>{fmtMoney(vm.totals.change, vm.currency)}</span></p>
            )}
          </div>
          {(vm.qr || vm.atcud) && (
            <div className="mt-3 flex flex-col items-center gap-1">
              {vm.qr && (
                <span className="rounded-lg bg-white p-1.5 ring-1 ring-black/10">
                  <QrCode text={vm.qr} size={132} />
                </span>
              )}
              {vm.atcud && <p className="font-mono text-[10px] font-bold">ATCUD: {vm.atcud}</p>}
              <p className="font-mono text-[9px] text-graphite-400">Hash: {vm.hash4 || vm.hash.slice(0, 4)}</p>
            </div>
          )}
          {vm.fiscalNotice && (
            <p className="mt-2 text-center text-[9px] leading-tight text-graphite-400">{vm.fiscalNotice}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {canReprint && (
            <Button variant="secondary" onClick={() => printReceipt(vm)} icon={<Printer className="h-4 w-4" />}>
              Imprimir
            </Button>
          )}
          <Button variant="accent" onClick={onNewSale} icon={<RotateCcw className="h-4 w-4" />}>
            Nova venda
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export { printReceipt };
