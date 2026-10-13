"use client";

/**
 * Vendas — histórico imutável de documentos. Devoluções geram NC
 * (nota de crédito) com reembolso proporcional; anulações geram NC e
 * marcam a venda como void. Documentos finalizados NUNCA são editados.
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Ban, Eye, Printer, Receipt, RotateCcw, Search, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea, Toggle } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import { printReceipt, type ReceiptVM } from "@/components/pos/receipt-modal";
import type { PaymentMethodOption } from "@/components/pos/payment-modal";

interface SaleListRow {
  id: string;
  document_number: string | null;
  created_at: number;
  status: string;
  channel: string;
  total_cents: number;
  paid_cents: number;
  tax_cents: number;
  discount_cents: number;
  customer_name: string | null;
  cashier_name: string | null;
  branch_name: string | null;
  terminal_name?: string | null;
  line_count: number;
  return_count: number;
}

interface SaleLineRow {
  id: string;
  product_name: string | null;
  name_snapshot: string;
  variant_label: string | null;
  qty_milli: number;
  returned_milli: number;
  unit: string;
  unit_price_cents: number;
  tax_rate_bps: number;
  discount_cents: number;
  total_cents: number;
  tax_cents: number;
  modifiers: string | null;
}

interface SalePaymentRow {
  id: string;
  method_key: string;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number | null;
  status: string;
}

interface ReturnRow {
  id: string;
  document_number: string;
  total_cents: number;
  reason_code: string;
  created_at: number;
  returned_qty?: number;
}

interface SaleDetail {
  sale: SaleListRow & { hash: string | null; void_reason?: string | null; guest_count?: number | null };
  lines: SaleLineRow[];
  payments: SalePaymentRow[];
  returns: ReturnRow[];
  org: { name: string; legal_name: string | null; tax_id: string | null };
}

const STATUS_BADGES: Record<string, { tone: "success" | "danger" | "warning" | "info" | "neutral"; label: string }> = {
  completed: { tone: "success", label: "concluída" },
  void: { tone: "danger", label: "anulada" },
  returned: { tone: "warning", label: "devolvida" },
  partial_return: { tone: "warning", label: "devolução parcial" },
  pending: { tone: "info", label: "pendente" },
};

const PAGE_SIZE = 25;

export default function SalesPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;

  const [rows, setRows] = useState<SaleListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("today");
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState<string>("");

  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // return flow
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnRestock, setReturnRestock] = useState(true);
  const [returnReason, setReturnReason] = useState("defeito");
  const [returnNote, setReturnNote] = useState("");
  const [returnMethod, setReturnMethod] = useState("");
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [returnBusy, setReturnBusy] = useState(false);

  // void flow
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);

  useEffect(() => {
    setBranchFilter(workspace.branchId ?? "");
  }, [workspace.branchId]);

  const periodBounds = useCallback(() => {
    const now = Date.now();
    const day = 86_400_000;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    switch (period) {
      case "today":
        return { from: midnight.getTime(), to: now };
      case "7d":
        return { from: now - 7 * day, to: now };
      case "30d":
        return { from: now - 30 * day, to: now };
      default:
        return { from: undefined, to: undefined };
    }
  }, [period]);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = periodBounds();
    try {
      const data = await api<{ rows: SaleListRow[]; total: number }>("/api/sales", {
        query: {
          branchId: branchFilter || undefined,
          status: status || undefined,
          search: search || undefined,
          from,
          to,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar vendas");
    } finally {
      setLoading(false);
    }
  }, [branchFilter, status, search, periodBounds, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<PaymentMethodOption[]>("/api/cash/methods").then(setMethods).catch(() => setMethods([]));
  }, []);

  async function openDetail(id: string) {
    try {
      const d = await api<SaleDetail>(`/api/sales/${id}`);
      setDetail(d);
      setDetailOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir venda");
    }
  }

  async function reprint(saleId: string) {
    try {
      const vm = await api<ReceiptVM>(`/api/sales/${saleId}/receipt`);
      printReceipt(vm);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) toast.error("Sem permissão para reimprimir (pos.reprint).");
      else toast.error("Falha ao reimprimir");
    }
  }

  /* --------- return maths (mirror of server proportional integer math) --------- */
  const returnLines = detail
    ? detail.lines
        .map((l) => {
          const qty = Math.round(parseFloat((returnQty[l.id] ?? "").replace(",", ".")) * 1000);
          return { line: l, qtyMilli: Number.isFinite(qty) && qty > 0 ? Math.min(qty, l.qty_milli - l.returned_milli) : 0 };
        })
        .filter((x) => x.qtyMilli > 0)
    : [];
  const refundTotal = returnLines.reduce(
    (a, x) => a + Math.round((x.line.total_cents * x.qtyMilli) / x.line.qty_milli),
    0,
  );

  function openReturnFlow() {
    if (!detail) return;
    setReturnQty({});
    setReturnRestock(true);
    setReturnReason("defeito");
    setReturnNote("");
    setReturnMethod(detail.payments[0]?.method_key ?? methods[0]?.key ?? "");
    setReturnOpen(true);
  }

  async function submitReturn() {
    if (!detail || !returnLines.length || !returnMethod) return;
    setReturnBusy(true);
    try {
      const res = await api<{ returnId: string; documentNumber: string; totalCents: number }>(
        `/api/sales/${detail.sale.id}/return`,
        {
          method: "POST",
          body: {
            lines: returnLines.map((x) => ({ saleLineId: x.line.id, qtyMilli: x.qtyMilli, restock: returnRestock })),
            reasonCode: returnReason,
            note: returnNote || undefined,
            restock: returnRestock,
            payments: [{ methodKey: returnMethod, amountCents: refundTotal }],
          },
        },
      );
      toast.success("Devolução registada", `NC ${res.documentNumber} · reembolso ${fmtMoney(res.totalCents, currency)}.`);
      setReturnOpen(false);
      await openDetail(detail.sale.id);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha na devolução");
    } finally {
      setReturnBusy(false);
    }
  }

  async function submitVoid() {
    if (!detail) return;
    setVoidBusy(true);
    try {
      await api(`/api/sales/${detail.sale.id}/void`, {
        method: "POST",
        body: { reason: voidReason.trim() },
      });
      toast.info("Venda anulada", "Emitida NC de anulação; o documento original permanece no histórico.");
      setVoidOpen(false);
      setVoidReason("");
      await openDetail(detail.sale.id);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao anular");
    } finally {
      setVoidBusy(false);
    }
  }

  const dayTotal = rows.reduce((a, r) => a + (r.status !== "void" ? r.total_cents : 0), 0);

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle={`${total} documento(s) · página atual: ${fmtMoney(dayTotal, currency)}`}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
          <Input
            className="pl-8"
            placeholder="Nº documento ou cliente…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-mist-200 dark:border-graphite-600">
          {[
            { key: "today", label: "Hoje" },
            { key: "7d", label: "7 dias" },
            { key: "30d", label: "30 dias" },
            { key: "all", label: "Tudo" },
          ].map((p) => (
            <button
              key={p.key}
              onClick={() => { setPeriod(p.key); setPage(0); }}
              className={clsx(
                "px-2.5 py-1.5 text-xs font-medium",
                period === p.key
                  ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700"
                  : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Estado">
          <option value="">Todos os estados</option>
          <option value="completed">Concluídas</option>
          <option value="void">Anuladas</option>
          <option value="returned">Devolvidas</option>
        </Select>
        <Select className="w-auto" value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(0); }} aria-label="Filial">
          <option value="">Todas as filiais</option>
          {workspace.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhuma venda no período" message="As vendas do POS aparecem aqui com documento, hash e rasto completo." icon={<Receipt className="h-8 w-8" />} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-mist-200 text-[10px] uppercase tracking-wider text-graphite-400 dark:border-graphite-700">
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Filial</th>
                  <th className="px-3 py-2">Caixa</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                {rows.map((r) => {
                  const badge = STATUS_BADGES[r.status] ?? { tone: "neutral" as const, label: r.status };
                  return (
                    <tr key={r.id} className={clsx("hover:bg-mist-50 dark:hover:bg-graphite-800/60", r.status === "void" && "opacity-60")}>
                      <td className="px-3 py-2">
                        <button className="font-mono font-semibold text-lime-dim hover:underline dark:text-lime-brand" onClick={() => openDetail(r.id)}>
                          {r.document_number ?? r.id.slice(0, 10)}
                        </button>
                        {r.return_count > 0 && <Badge tone="warning" className="ml-1.5">NC×{r.return_count}</Badge>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="px-3 py-2">{r.branch_name ?? "—"}</td>
                      <td className="px-3 py-2">{r.cashier_name ?? "—"}</td>
                      <td className="px-3 py-2">{r.customer_name ?? <span className="text-graphite-400">anónima</span>}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmtMoney(r.total_cents, currency)}</td>
                      <td className="px-3 py-2"><Badge tone={badge.tone}>{badge.label}</Badge></td>
                      <td className="px-3 py-2">
                        <span className="flex justify-end gap-1">
                          <button className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => openDetail(r.id)} aria-label="Ver detalhe">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {workspace.can("pos.reprint") && (
                            <button className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => reprint(r.id)} aria-label="Reimprimir talão">
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="mt-3">
            <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
          </div>
        )}
      </div>

      {/* detail */}
      <Modal open={detailOpen && detail !== null} onClose={() => setDetailOpen(false)} title={`Venda ${detail?.sale.document_number ?? ""}`} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-graphite-400">
              <Badge tone={(STATUS_BADGES[detail.sale.status] ?? { tone: "neutral" }).tone}>
                {(STATUS_BADGES[detail.sale.status] ?? { label: detail.sale.status }).label}
              </Badge>
              <span>{fmtDateTime(detail.sale.created_at)}</span>
              <span>· {detail.sale.branch_name}</span>
              <span>· caixa {detail.sale.cashier_name ?? "—"}</span>
              <span>· {detail.sale.customer_name ?? "venda anónima"}</span>
              {detail.sale.channel && <span>· canal {detail.sale.channel}</span>}
            </div>

            {detail.sale.status === "void" && detail.sale.void_reason && (
              <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-danger">
                <Ban className="mr-1 inline h-3.5 w-3.5" />
                Anulada: {detail.sale.void_reason}
              </p>
            )}

            <div className="overflow-hidden rounded-lg border border-mist-200 dark:border-graphite-600">
              <table className="w-full text-left text-xs">
                <thead className="bg-mist-100 dark:bg-graphite-800">
                  <tr className="text-[10px] uppercase tracking-wider text-graphite-400">
                    <th className="px-3 py-1.5">Artigo</th>
                    <th className="px-3 py-1.5 text-right">Qtd.</th>
                    <th className="px-3 py-1.5 text-right">Preço</th>
                    <th className="px-3 py-1.5 text-right">Desc.</th>
                    <th className="px-3 py-1.5 text-right">IVA</th>
                    <th className="px-3 py-1.5 text-right">Total</th>
                    <th className="px-3 py-1.5 text-right">Devolvido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                  {detail.lines.map((l) => {
                    const mods = JSON.parse(l.modifiers || "[]") as { name: string }[];
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5">
                          <p className="font-medium">{l.product_name ?? l.name_snapshot}{l.variant_label ? ` · ${l.variant_label}` : ""}</p>
                          {mods.map((m, i) => (
                            <p key={i} className="text-[10px] text-graphite-400">+ {m.name}</p>
                          ))}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtQty(l.qty_milli, l.unit)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.unit_price_cents, currency)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.discount_cents ? `−${fmtMoney(l.discount_cents, currency)}` : "—"}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtPct(l.tax_rate_bps, 0)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{fmtMoney(l.total_cents, currency)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-warning">
                          {l.returned_milli > 0 ? fmtQty(l.returned_milli, l.unit) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Pagamentos</p>
                <ul className="space-y-1 text-xs">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span>
                        {p.method_key}
                        <Badge tone={p.status === "confirmed" ? "success" : p.status === "refunded" ? "warning" : "neutral"} className="ml-1.5">{p.status}</Badge>
                      </span>
                      <span className="font-mono tabular-nums">{fmtMoney(p.amount_cents, currency)}</span>
                    </li>
                  ))}
                  {detail.payments[0]?.change_cents ? (
                    <li className="flex justify-between text-graphite-400">
                      <span>Troco</span>
                      <span className="font-mono tabular-nums">{fmtMoney(detail.payments[0].change_cents, currency)}</span>
                    </li>
                  ) : null}
                </ul>
              </div>
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Totais</p>
                <ul className="space-y-1 text-xs">
                  <li className="flex justify-between"><span className="text-graphite-400">Descontos</span><span className="font-mono tabular-nums">−{fmtMoney(detail.sale.discount_cents, currency)}</span></li>
                  <li className="flex justify-between"><span className="text-graphite-400">IVA incluído</span><span className="font-mono tabular-nums">{fmtMoney(detail.sale.tax_cents, currency)}</span></li>
                  <li className="flex justify-between text-sm font-bold"><span>TOTAL</span><span className="font-mono tabular-nums">{fmtMoney(detail.sale.total_cents, currency)}</span></li>
                </ul>
                {detail.sale.hash && (
                  <p className="mt-2 break-all font-mono text-[9px] leading-tight text-graphite-400" title="Hash SHA-256 do documento encadeada ao documento anterior">
                    hash: {detail.sale.hash}
                  </p>
                )}
              </div>
            </div>

            {detail.returns.length > 0 && (
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Notas de crédito associadas</p>
                <ul className="space-y-1 text-xs">
                  {detail.returns.map((r, i) => (
                    <li key={r.id + i} className="flex justify-between">
                      <span className="font-mono">{r.document_number} <span className="font-sans text-graphite-400">· {r.reason_code} · {fmtDateTime(r.created_at)}</span></span>
                      <span className="font-mono tabular-nums text-warning">{fmtMoney(r.total_cents, currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-mist-200 pt-3 dark:border-graphite-700">
              {workspace.can("pos.reprint") && (
                <Button variant="secondary" size="sm" onClick={() => reprint(detail.sale.id)} icon={<Printer className="h-3.5 w-3.5" />}>
                  Reimprimir talão
                </Button>
              )}
              {workspace.can("pos.refund") && detail.sale.status !== "void" && detail.sale.status !== "returned" && (
                <Button variant="secondary" size="sm" onClick={openReturnFlow} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                  Devolver artigos
                </Button>
              )}
              {workspace.can("pos.void_sale") && detail.sale.status === "completed" && detail.returns.length === 0 && (
                <Button variant="danger" size="sm" onClick={() => { setVoidReason(""); setVoidOpen(true); }} icon={<Ban className="h-3.5 w-3.5" />}>
                  Anular venda
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* return modal */}
      <Modal open={returnOpen && detail !== null} onClose={() => setReturnOpen(false)} title="Devolver artigos (emite NC)" wide>
        {detail && (
          <div className="space-y-4">
            <ul className="space-y-1.5">
              {detail.lines.map((l) => {
                const returnable = l.qty_milli - l.returned_milli;
                if (returnable <= 0) return null;
                return (
                  <li key={l.id} className="flex items-center gap-3 rounded-lg border border-mist-200 px-3 py-2 dark:border-graphite-600">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {l.product_name ?? l.name_snapshot}{l.variant_label ? ` · ${l.variant_label}` : ""}
                      </span>
                      <span className="block text-[10px] text-graphite-400">
                        vendido {fmtQty(l.qty_milli, l.unit)} · devolvível {fmtQty(returnable, l.unit)} · {fmtMoney(l.total_cents, currency)}
                      </span>
                    </span>
                    <Input
                      className="h-8 w-24 text-right font-mono text-xs"
                      type="number"
                      min={0}
                      step={l.unit === "un" ? 1 : 0.001}
                      max={returnable / 1000}
                      placeholder="0"
                      value={returnQty[l.id] ?? ""}
                      onChange={(e) => setReturnQty((m) => ({ ...m, [l.id]: e.target.value }))}
                      aria-label={`Quantidade a devolver de ${l.product_name ?? l.name_snapshot}`}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Motivo" required>
                <Select value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
                  <option value="defeito">Artigo com defeito</option>
                  <option value="artigo_errado">Artigo errado</option>
                  <option value="arrependimento">Arrependimento do cliente</option>
                  <option value="troca">Troca</option>
                  <option value="outro">Outro</option>
                </Select>
              </Field>
              <Field label="Reembolso via" required>
                <Select value={returnMethod} onChange={(e) => setReturnMethod(e.target.value)}>
                  {methods.filter((m) => m.enabled === 1).map((m) => (
                    <option key={m.key} value={m.key}>{m.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end pb-1">
                <Toggle checked={returnRestock} onChange={setReturnRestock} label="Repor stock (FEFO quando aplicável)" />
              </div>
            </div>
            <Field label="Nota">
              <Textarea rows={2} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Detalhes adicionais…" />
            </Field>
            <div className="flex items-center justify-between rounded-lg bg-mist-100 px-4 py-2.5 dark:bg-graphite-800">
              <span className="text-xs font-medium">Reembolso proporcional (cálculo inteiro, igual ao servidor)</span>
              <span className="font-mono text-lg font-bold tabular-nums">{fmtMoney(refundTotal, currency)}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancelar</Button>
              <Button variant="accent" loading={returnBusy} disabled={!returnLines.length || !returnMethod} onClick={submitReturn} icon={<Undo2 className="h-4 w-4" />}>
                Registar devolução
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* void modal */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="Anular venda">
        <div className="space-y-4">
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-warning">
            A anulação NÃO apaga nem edita o documento: emite uma nota de crédito de anulação, marca a venda como
            <strong> void</strong> com motivo obrigatório e reverte o stock. Toda a cadeia fica auditada.
          </p>
          <Field label="Motivo da anulação" required hint="Mínimo 3 caracteres — fica registado no documento e na auditoria.">
            <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Ex.: venda lançada no terminal errado, erro de valor…" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVoidOpen(false)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={voidBusy}
              disabled={voidReason.trim().length < 3}
              onClick={async () => {
                const ok = await confirm({
                  title: "Confirmar anulação",
                  message: "Anular esta venda e emitir NC de anulação? A operação é irreversível.",
                  confirmLabel: "Anular venda",
                  danger: true,
                });
                if (ok) submitVoid();
              }}
            >
              Anular venda
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
