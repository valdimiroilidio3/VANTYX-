"use client";

/**
 * Sala — mapa de mesas, pedidos (comandas), modificadores, reservas e fecho de conta.
 * Os pedidos são persistidos no servidor: sobreviver a refresh é garantido.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  Clock,
  Coffee,
  Plus,
  RefreshCw,
  Send,
  ShoppingCart,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtAge, fmtMoney, fmtQty, fmtTime } from "@/lib/format";
import { PaymentModal, type PaymentDraft, type PaymentMethodOption } from "@/components/pos/payment-modal";
import { SupervisorModal } from "@/components/pos/supervisor-modal";
import { ReceiptModal, type ReceiptVM } from "@/components/pos/receipt-modal";
import { newClientRef, type CartLine, type PosSearchResult } from "@/lib/pos/cart";

interface TableRow {
  id: string;
  name: string;
  zone: string | null;
  seats: number;
  status: string;
  order_id: string | null;
  order_opened_at: number | null;
  order_total_cents: number | null;
  guest_count: number | null;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  name_snapshot: string;
  product_name?: string | null;
  variant_label?: string | null;
  qty_milli: number;
  unit_price_cents: number;
  modifiers: string;
  notes: string | null;
  status: string;
  created_at: number;
}

interface OrderDetail {
  order: Record<string, never> & {
    id: string;
    table_name: string | null;
    channel: string;
    guest_count: number;
    opened_at: number;
    customer_name: string | null;
    status: string;
  };
  items: OrderItemRow[];
  tickets: { id: string; status: string; station: string }[];
}

interface ModifierGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: number;
  options: { id: string; name: string; price_delta_cents: number }[];
  products: { product_id: string }[];
}

interface ReservationRow {
  id: string;
  customer_name: string | null;
  customer_record_name: string | null;
  phone: string | null;
  party_size: number;
  reserved_for: number;
  status: string;
  table_name: string | null;
  note: string | null;
}

/** Line in checkout shape, built from persisted order items. */
interface BillLine {
  productId: string;
  variantId: string | null;
  qtyMilli: number;
  orderItemId: string;
  modifiers: { name: string; priceCents: number }[];
  notes?: string;
}

interface PendingDraft {
  lines: BillLine[];
  payments: PaymentDraft[];
  clientRef: string;
  idempotencyKey: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  dine_in: "Mesa",
  takeaway: "Takeaway",
  counter: "Balcão",
  delivery: "Entrega",
};

const CHECKOUT_CHANNEL: Record<string, "in_store" | "takeaway" | "counter" | "delivery"> = {
  dine_in: "in_store",
  takeaway: "takeaway",
  counter: "counter",
  delivery: "delivery",
};

export default function RestaurantFloorPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;
  const branchId = workspace.branchId;

  const [tables, setTables] = useState<TableRow[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [openFor, setOpenFor] = useState<TableRow | null>(null);
  const [guestCount, setGuestCount] = useState("2");
  const [takeawayOpen, setTakeawayOpen] = useState(false);
  const [takeawayChannel, setTakeawayChannel] = useState<"takeaway" | "counter" | "delivery">("takeaway");
  const [takeawayCustomer, setTakeawayCustomer] = useState("");

  // Item composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PosSearchResult[]>([]);
  const [draftLines, setDraftLines] = useState<CartLine[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [composeFor, setComposeFor] = useState<PosSearchResult | null>(null);
  const [composeQty, setComposeQty] = useState("1");
  const [composeNotes, setComposeNotes] = useState("");
  const [composeMods, setComposeMods] = useState<Record<string, boolean>>({});

  // Reservations
  const [resOpen, setResOpen] = useState(false);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [resForm, setResForm] = useState({ name: "", phone: "", guests: "2", when: "", tableId: "", notes: "" });

  // Bill
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [supervisor, setSupervisor] = useState<{ reason: string } | null>(null);
  const [receipt, setReceipt] = useState<ReceiptVM | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [cancelItemFor, setCancelItemFor] = useState<OrderItemRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const loadTables = useCallback(async () => {
    if (!branchId) return;
    try {
      const data = await api<{ tables: TableRow[] }>("/api/restaurant/tables", { query: { branchId } });
      setTables(data.tables);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        toast.error("Sem permissão para a sala (restaurant.floor).");
      }
    } finally {
      setLoadingTables(false);
    }
  }, [branchId, toast]);

  const loadDetail = useCallback(async (orderId: string) => {
    try {
      const d = await api<OrderDetail>(`/api/restaurant/orders/${orderId}`);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    loadTables();
    api<PaymentMethodOption[]>("/api/cash/methods").then(setMethods).catch(() => setMethods([]));
    api<ModifierGroup[]>("/api/restaurant/modifiers").then(setGroups).catch(() => setGroups([]));
  }, [loadTables]);

  // Auto-refresh: tables every 20s, open order every 8s
  useEffect(() => {
    const t = setInterval(loadTables, 20_000);
    return () => clearInterval(t);
  }, [loadTables]);

  useEffect(() => {
    if (!selectedOrderId) return;
    loadDetail(selectedOrderId);
    const t = setInterval(() => loadDetail(selectedOrderId), 8_000);
    return () => clearInterval(t);
  }, [selectedOrderId, loadDetail]);

  // Reservations for today
  useEffect(() => {
    if (!resOpen || !branchId) return;
    api<{ reservations: ReservationRow[] }>("/api/restaurant/reservations", {
      query: { branchId, day: Date.now() },
    })
      .then((d) => setReservations(d.reservations))
      .catch(() => setReservations([]));
  }, [resOpen, branchId]);

  const zones = useMemo(() => {
    const map = new Map<string, TableRow[]>();
    for (const t of tables) {
      const z = t.zone || "Sala";
      map.set(z, [...(map.get(z) ?? []), t]);
    }
    return [...map.entries()];
  }, [tables]);

  const openItems = detail?.items.filter((i) => !["cancelled", "billed"].includes(i.status)) ?? [];
  const openTotal = openItems.reduce(
    (a, i) => a + Math.round((i.qty_milli * i.unit_price_cents) / 1000),
    0,
  );

  async function openOrder(table: TableRow | null, channel: keyof typeof CHECKOUT_CHANNEL, guests: number, customerName?: string) {
    if (!branchId) return;
    try {
      const res = await api<{ orderId: string }>("/api/restaurant/orders", {
        method: "POST",
        body: {
          action: "open",
          branchId,
          tableId: table?.id ?? null,
          channel,
          guestCount: guests,
          customerName: customerName || null,
        },
      });
      setSelectedOrderId(res.orderId);
      setOpenFor(null);
      setTakeawayOpen(false);
      loadTables();
      loadDetail(res.orderId);
      toast.success(channel === "dine_in" ? `Mesa ${table?.name} aberta` : "Pedido aberto");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir pedido");
    }
  }

  /* --------- item composer --------- */
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !composerOpen) {
      setSearchResults([]);
      return;
    }
    const h = setTimeout(() => {
      api<{ results: PosSearchResult[] }>("/api/pos/search", { query: { q, branchId: branchId ?? undefined, limit: 12 } })
        .then((d) => setSearchResults(d.results))
        .catch(() => setSearchResults([]));
    }, 220);
    return () => clearTimeout(h);
  }, [searchQuery, composerOpen, branchId]);

  function groupsFor(productId: string): ModifierGroup[] {
    return groups.filter((g) => g.products.some((p) => p.product_id === productId));
  }

  function startCompose(result: PosSearchResult) {
    const gs = groupsFor(result.productId);
    setComposeFor(result);
    setComposeQty("1");
    setComposeNotes("");
    const preselect: Record<string, boolean> = {};
    for (const g of gs) {
      if (g.required === 1 && g.options.length > 0) preselect[`${g.id}:${g.options[0]!.id}`] = true;
    }
    setComposeMods(preselect);
  }

  function addComposedToDraft() {
    if (!composeFor) return;
    const qty = Math.max(1, Math.round(parseFloat(composeQty.replace(",", ".")) * 1000) || 1000);
    const gs = groupsFor(composeFor.productId);
    const mods: { groupId: string; groupName: string; optionId: string; name: string; priceCents: number }[] = [];
    for (const g of gs) {
      const selected = g.options.filter((o) => composeMods[`${g.id}:${o.id}`]);
      if (g.max_select && selected.length > g.max_select) {
        toast.error(`Máximo ${g.max_select} opções em “${g.name}”.`);
        return;
      }
      for (const o of selected) {
        mods.push({ groupId: g.id, groupName: g.name, optionId: o.id, name: o.name, priceCents: o.price_delta_cents });
      }
    }
    const missingRequired = gs.filter((g) => g.required === 1 && !g.options.some((o) => composeMods[`${g.id}:${o.id}`]));
    if (missingRequired.length) {
      toast.error(`Selecione: ${missingRequired.map((g) => g.name).join(", ")}.`);
      return;
    }
    const modTotal = mods.reduce((a, m) => a + m.priceCents, 0);
    setDraftLines((list) => [
      ...list,
      {
        lineId: `D${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: composeFor.productId,
        variantId: composeFor.variantId,
        name: composeFor.name,
        variantLabel: composeFor.variantLabel,
        sku: composeFor.sku,
        unit: composeFor.unit,
        saleMode: composeFor.saleMode,
        priceCents: composeFor.priceCents + modTotal,
        taxRateBps: composeFor.taxRateBps,
        qtyMilli: qty,
        trackStock: composeFor.trackStock,
        stockMilli: composeFor.stockMilli,
        image: composeFor.image,
        discountCents: 0,
        notes: composeNotes || undefined,
      },
    ]);
    setComposeFor(null);
    setSearchQuery("");
    toast.info("Na comanda (rascunho)", "Envie à cozinha quando o pedido estiver completo.");
  }

  async function sendToKitchen() {
    if (!selectedOrderId || !draftLines.length) return;
    try {
      const result = await api<{ ticketIds: string[] }>("/api/restaurant/orders", {
        method: "POST",
        body: {
          action: "add_items",
          orderId: selectedOrderId,
          items: draftLines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qtyMilli: l.qtyMilli,
            notes: l.notes,
            sendToKitchen: true,
          })),
        },
      });
      setDraftLines([]);
      setComposerOpen(false);
      loadDetail(selectedOrderId);
      loadTables();
      toast.success("Enviado à cozinha", `${result.ticketIds.length} ticket(s) criados.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar");
    }
  }

  /* --------- bill --------- */
  function startBill() {
    if (!detail || !openItems.length) return;
    const lines: BillLine[] = openItems.map((i) => {
      const mods = JSON.parse(i.modifiers || "[]") as { name: string; priceCents: number }[];
      return {
        productId: i.product_id,
        variantId: i.variant_id,
        qtyMilli: i.qty_milli,
        orderItemId: i.id,
        // Server prices each line; priced modifiers are sent as a flat
        // per-line amount (unit modifier price × qty), matching how the
        // open total is displayed on the floor panel.
        modifiers: mods
          .filter((m) => m.priceCents > 0)
          .map((m) => ({ name: m.name, priceCents: Math.round((m.priceCents * i.qty_milli) / 1000) })),
        ...(i.notes ? { notes: i.notes } : {}),
      };
    });
    if (lines.some((l) => !l.productId)) {
      toast.error("Itens sem produto associado — recarregue o pedido.");
      loadDetail(detail.order.id);
      return;
    }
    setPending({
      lines,
      payments: [],
      clientRef: newClientRef(),
      idempotencyKey: `rpos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    });
    setPayOpen(true);
  }

  async function payBill(payments: PaymentDraft[], sup?: { userId: string; pin: string }) {
    if (!detail || !pending || !branchId) return;
    setPayBusy(true);
    try {
      const result = await api<{ saleId: string; documentNumber: string | null; totalCents: number; changeCents: number }>("/api/pos/checkout", {
        method: "POST",
        body: {
          branchId,
          terminalId: workspace.terminalId,
          channel: CHECKOUT_CHANNEL[detail.order.channel] ?? "in_store",
          orderId: detail.order.id,
          closeOrder: true,
          guestCount: detail.order.guest_count,
          clientRef: pending.clientRef,
          idempotencyKey: pending.idempotencyKey,
          lines: pending.lines,
          payments: payments.map((p) => ({ ...p, status: "confirmed" })),
          ...(sup ? { supervisor: sup } : {}),
        },
      });
      setPayOpen(false);
      setPending(null);
      setSelectedOrderId(null);
      setDetail(null);
      loadTables();
      try {
        setReceipt(await api<ReceiptVM>(`/api/sales/${result.saleId}/receipt`));
      } catch {
        toast.success("Conta fechada", `${result.documentNumber ?? ""} · ${fmtMoney(result.totalCents, currency)}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        setSupervisor({ reason: err.body.message });
        setPayOpen(false);
        return;
      }
      toast.error("Pagamento recusado", err instanceof Error ? err.message : "Erro");
    } finally {
      setPayBusy(false);
    }
  }

  /* --------- render --------- */
  return (
    <>
      <PageHeader
        title="Sala & Mesas"
        subtitle={`${tables.length} mesas · ${tables.filter((t) => t.status === "occupied").length} ocupadas`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setResOpen(true)} icon={<CalendarClock className="h-3.5 w-3.5" />}>
              Reservas
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setTakeawayOpen(true)} icon={<Coffee className="h-3.5 w-3.5" />}>
              Takeaway / Balcão
            </Button>
            <Button variant="secondary" size="sm" onClick={loadTables} icon={<RefreshCw className={clsx("h-3.5 w-3.5", loadingTables && "animate-spin")} />}>
              Atualizar
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[1fr_26rem]">
        {/* Floor map */}
        <div className="min-w-0 space-y-4">
          {!branchId && <EmptyState title="Selecione uma filial" message="Escolha a filial na barra superior para ver as mesas." />}
          {zones.map(([zone, zoneTables]) => (
            <section key={zone}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-graphite-400">{zone}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {zoneTables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.order_id) {
                        setSelectedOrderId(t.order_id);
                      } else {
                        setOpenFor(t);
                        setGuestCount(String(t.seats || 2));
                      }
                    }}
                    className={clsx(
                      "rounded-lg border p-3 text-left transition-all",
                      t.status === "occupied" && "border-lime-brand/60 bg-lime-brand/10",
                      t.status === "free" && "border-mist-200 bg-white hover:border-lime-brand dark:border-graphite-600 dark:bg-graphite-850",
                      t.status === "reserved" && "border-blue-500/50 bg-blue-500/10",
                      t.status === "bill_requested" && "border-amber-500/60 bg-amber-500/10",
                      selectedOrderId === t.order_id && "ring-2 ring-lime-brand",
                    )}
                  >
                    <span className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-bold">
                        <UtensilsCrossed className="h-3.5 w-3.5 text-graphite-400" />
                        {t.name}
                      </span>
                      <Badge
                        tone={
                          t.status === "occupied" ? "accent" : t.status === "reserved" ? "info" : t.status === "bill_requested" ? "warning" : "neutral"
                        }
                      >
                        {t.status === "occupied" ? "ocupada" : t.status === "reserved" ? "reservada" : t.status === "bill_requested" ? "conta" : "livre"}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-[10px] text-graphite-400">{t.seats} lugares</span>
                    {t.order_id && (
                      <span className="mt-1.5 block">
                        <span className="block font-mono text-sm font-bold tabular-nums">{fmtMoney(t.order_total_cents ?? 0, currency)}</span>
                        <span className="flex items-center gap-1 text-[10px] text-graphite-400">
                          <Clock className="h-2.5 w-2.5" />
                          {t.order_opened_at ? fmtAge(Date.now() - t.order_opened_at) : ""}
                          {t.guest_count ? ` · ${t.guest_count}p` : ""}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {branchId && tables.length === 0 && !loadingTables && (
            <EmptyState
              title="Nenhuma mesa configurada"
              message="Crie mesas em Definições → Estrutura (ou use Takeaway/Balcão sem mesa)."
              icon={<UtensilsCrossed className="h-8 w-8" />}
            />
          )}
        </div>

        {/* Order panel */}
        <div className="flex min-h-[24rem] flex-col rounded-lg border border-mist-200 bg-white xl:sticky xl:top-3 xl:max-h-[calc(100vh-7rem)] dark:border-graphite-700 dark:bg-graphite-850">
          {!selectedOrderId || !detail ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                title="Selecione um pedido"
                message="Toque numa mesa ocupada para ver a comanda, ou abra uma nova."
                icon={<UtensilsCrossed className="h-8 w-8" />}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-mist-200 px-3 py-2.5 dark:border-graphite-700">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {detail.order.table_name ?? CHANNEL_LABELS[detail.order.channel] ?? detail.order.channel}
                    {detail.order.customer_name ? <span className="font-normal text-graphite-400"> · {detail.order.customer_name}</span> : null}
                  </p>
                  <p className="text-[10px] text-graphite-400">
                    {CHANNEL_LABELS[detail.order.channel]} · {detail.order.guest_count} pessoa(s) · aberta {fmtTime(detail.order.opened_at)}
                  </p>
                </div>
                <button className="rounded p-1 text-graphite-400 hover:text-mist-100" onClick={() => { setSelectedOrderId(null); setDetail(null); }} aria-label="Fechar painel">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <ul className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                  {detail.items.map((i) => {
                    const mods = JSON.parse(i.modifiers || "[]") as { name: string; priceCents: number }[];
                    const cancelled = i.status === "cancelled";
                    const billed = i.status === "billed";
                    return (
                      <li key={i.id} className={clsx("px-3 py-2", cancelled && "opacity-40")}>
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">
                              {fmtQty(i.qty_milli)}× {i.product_name ?? i.name_snapshot}
                              {i.variant_label ? ` · ${i.variant_label}` : ""}
                            </span>
                            {mods.map((m, mi) => (
                              <span key={mi} className="block truncate text-[10px] text-graphite-400">+ {m.name}{m.priceCents ? ` (${fmtMoney(m.priceCents, currency)})` : ""}</span>
                            ))}
                            {i.notes && <span className="block truncate text-[10px] italic text-warning">“{i.notes}”</span>}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums">
                            {fmtMoney(Math.round((i.qty_milli * i.unit_price_cents) / 1000), currency)}
                          </span>
                          {!cancelled && !billed && workspace.can("restaurant.floor") && (
                            <button className="shrink-0 rounded p-0.5 text-graphite-400 hover:text-danger" onClick={() => { setCancelItemFor(i); setCancelReason(""); }} aria-label="Cancelar item">
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <span className="mt-0.5 flex gap-1.5">
                          {billed && <Badge tone="neutral">faturado</Badge>}
                          {cancelled && <Badge tone="danger">cancelado</Badge>}
                          {i.status === "sent" && <Badge tone="info">cozinha</Badge>}
                        </span>
                      </li>
                    );
                  })}
                  {detail.items.length === 0 && (
                    <li className="px-3 py-6 text-center text-[11px] text-graphite-400">Pedido sem itens — adicione à comanda.</li>
                  )}
                </ul>
              </div>

              <div className="border-t border-mist-200 p-3 dark:border-graphite-700">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs font-semibold">Total aberto</span>
                  <span className="font-mono text-xl font-bold tabular-nums">{fmtMoney(openTotal, currency)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setComposerOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
                    Adicionar itens
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => { setMoveOpen(true); setMoveTarget(""); }} icon={<ArrowRightLeft className="h-3.5 w-3.5" />}>
                    Mover mesa
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Cancelar pedido",
                        message: "O pedido será cancelado e a mesa libertada. Itens já enviados à cozinha devem ser comunicados verbalmente. Continuar?",
                        confirmLabel: "Cancelar pedido",
                        danger: true,
                      });
                      if (!ok || !selectedOrderId) return;
                      try {
                        await api(`/api/restaurant/orders/${selectedOrderId}`, {
                          method: "POST",
                          body: { action: "cancel_order", reason: "Cancelado pelo operador na sala" },
                        });
                        setSelectedOrderId(null);
                        setDetail(null);
                        loadTables();
                        toast.info("Pedido cancelado");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Falha");
                      }
                    }}
                    icon={<Ban className="h-3.5 w-3.5" />}
                  >
                    Cancelar
                  </Button>
                  <Button variant="accent" size="sm" disabled={!openItems.length} onClick={startBill} icon={<ShoppingCart className="h-3.5 w-3.5" />}>
                    Fechar conta
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Open table modal */}
      <Modal open={openFor !== null} onClose={() => setOpenFor(null)} title={`Abrir mesa ${openFor?.name ?? ""}`}>
        <div className="space-y-4">
          <Field label="Nº de pessoas" required>
            <Input type="number" min={1} max={99} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} autoFocus />
          </Field>
          <Button
            variant="accent"
            className="w-full"
            onClick={() => openFor && openOrder(openFor, "dine_in", Math.max(1, parseInt(guestCount) || 1))}
          >
            Abrir pedido <ArrowRightLeft className="h-4 w-4" />
          </Button>
        </div>
      </Modal>

      {/* Takeaway / counter modal */}
      <Modal open={takeawayOpen} onClose={() => setTakeawayOpen(false)} title="Novo pedido sem mesa">
        <div className="space-y-4">
          <Field label="Canal">
            <Select value={takeawayChannel} onChange={(e) => setTakeawayChannel(e.target.value as typeof takeawayChannel)}>
              <option value="takeaway">Takeaway</option>
              <option value="counter">Balcão</option>
              <option value="delivery">Entrega</option>
            </Select>
          </Field>
          <Field label="Nome do cliente (opcional)">
            <Input value={takeawayCustomer} onChange={(e) => setTakeawayCustomer(e.target.value)} placeholder="Ex.: João — encomenda telefónica" />
          </Field>
          <Button variant="accent" className="w-full" onClick={() => openOrder(null, takeawayChannel, 1, takeawayCustomer || undefined)}>
            Abrir pedido
          </Button>
        </div>
      </Modal>

      {/* Item composer */}
      <Modal open={composerOpen} onClose={() => setComposerOpen(false)} title="Adicionar à comanda" wide>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar produto…"
              autoFocus
            />
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {searchResults.map((r) => (
                <li key={`${r.productId}:${r.variantId ?? ""}`}>
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-mist-200 px-2.5 py-1.5 text-left hover:border-lime-brand dark:border-graphite-600"
                    onClick={() => startCompose(r)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{r.name}{r.variantLabel ? ` · ${r.variantLabel}` : ""}</span>
                      <span className="block text-[10px] text-graphite-400">{groupsFor(r.productId).length ? `${groupsFor(r.productId).length} grupo(s) de modificadores` : "sem modificadores"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold">{fmtMoney(r.priceCents, currency)}</span>
                  </button>
                </li>
              ))}
              {searchResults.length === 0 && searchQuery && (
                <li className="py-4 text-center text-[11px] text-graphite-400">Sem resultados.</li>
              )}
            </ul>
          </div>

          <div>
            {!composeFor ? (
              draftLines.length === 0 ? (
                <EmptyState title="Rascunho vazio" message="Escolha um produto à esquerda; os itens aparecem aqui antes de enviar à cozinha." />
              ) : (
                <div className="space-y-2">
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {draftLines.map((l, i) => (
                      <li key={l.lineId} className="flex items-center gap-2 rounded-md border border-mist-200 px-2.5 py-1.5 dark:border-graphite-600">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{fmtQty(l.qtyMilli)}× {l.name}{l.variantLabel ? ` · ${l.variantLabel}` : ""}</span>
                          {l.notes && <span className="block truncate text-[10px] italic text-warning">“{l.notes}”</span>}
                        </span>
                        <span className="font-mono text-xs tabular-nums">{fmtMoney(Math.round((l.qtyMilli * l.priceCents) / 1000), currency)}</span>
                        <button className="text-graphite-400 hover:text-danger" onClick={() => setDraftLines((list) => list.filter((_, j) => j !== i))} aria-label="Remover">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button variant="accent" className="w-full" onClick={sendToKitchen} icon={<Send className="h-4 w-4" />}>
                    Enviar à cozinha ({draftLines.length})
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold">{composeFor.name}{composeFor.variantLabel ? ` · ${composeFor.variantLabel}` : ""}</p>
                <Field label="Quantidade">
                  <Input type="number" min={1} step={1} value={composeQty} onChange={(e) => setComposeQty(e.target.value)} />
                </Field>
                {groupsFor(composeFor.productId).map((g) => (
                  <div key={g.id}>
                    <p className="label-base">
                      {g.name}
                      {g.required === 1 && <span className="ml-1 text-danger">*</span>}
                      <span className="ml-1 font-normal text-graphite-400">
                        ({g.min_select ?? 0}–{g.max_select || g.options.length})
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {g.options.map((o) => {
                        const key = `${g.id}:${o.id}`;
                        const active = Boolean(composeMods[key]);
                        return (
                          <button
                            key={o.id}
                            className={clsx(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                              active
                                ? "border-lime-brand bg-lime-brand/15 text-lime-dim dark:text-lime-brand"
                                : "border-mist-200 text-graphite-500 hover:border-graphite-400 dark:border-graphite-600 dark:text-graphite-300",
                            )}
                            onClick={() => setComposeMods((m) => ({ ...m, [key]: !m[key] }))}
                          >
                            {o.name}{o.price_delta_cents ? ` +${fmtMoney(o.price_delta_cents, currency)}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <Field label="Nota para a cozinha">
                  <Textarea rows={2} value={composeNotes} onChange={(e) => setComposeNotes(e.target.value)} placeholder="Ex.: sem cebola, ponto da carne…" />
                </Field>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setComposeFor(null)}>Voltar</Button>
                  <Button variant="accent" className="flex-1" onClick={addComposedToDraft} icon={<Plus className="h-4 w-4" />}>
                    Adicionar à comanda
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Move table */}
      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title="Mover para outra mesa">
        <div className="space-y-4">
          <Field label="Mesa destino (livre)" required>
            <Select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
              <option value="">Selecionar…</option>
              {tables.filter((t) => t.status === "free").map((t) => (
                <option key={t.id} value={t.id}>{t.zone ? `${t.zone} · ` : ""}{t.name} ({t.seats}p)</option>
              ))}
            </Select>
          </Field>
          <Button
            variant="accent"
            className="w-full"
            disabled={!moveTarget || !selectedOrderId}
            onClick={async () => {
              try {
                await api(`/api/restaurant/orders/${selectedOrderId}`, {
                  method: "POST",
                  body: { action: "move_table", toTableId: moveTarget },
                });
                setMoveOpen(false);
                loadTables();
                loadDetail(selectedOrderId!);
                toast.success("Pedido movido");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Falha ao mover");
              }
            }}
          >
            Mover
          </Button>
        </div>
      </Modal>

      {/* Cancel item */}
      <Modal open={cancelItemFor !== null} onClose={() => setCancelItemFor(null)} title="Cancelar item da comanda">
        <div className="space-y-4">
          <p className="text-xs text-graphite-400">
            {cancelItemFor ? `${fmtQty(cancelItemFor.qty_milli)}× ${cancelItemFor.product_name ?? cancelItemFor.name_snapshot}` : ""} — o cancelamento fica registado com motivo (rastreabilidade; nunca é apagado).
          </p>
          <Field label="Motivo" required>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Ex.: pedido do cliente, erro de lançamento" autoFocus />
          </Field>
          <Button
            variant="danger"
            className="w-full"
            disabled={cancelReason.trim().length < 2 || !selectedOrderId || !cancelItemFor}
            onClick={async () => {
              try {
                const d = await api<OrderDetail>(`/api/restaurant/orders/${selectedOrderId}`, {
                  method: "POST",
                  body: { action: "cancel_item", itemId: cancelItemFor!.id, reason: cancelReason.trim() },
                });
                setDetail(d);
                setCancelItemFor(null);
                loadTables();
                toast.info("Item cancelado");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Falha");
              }
            }}
          >
            Cancelar item
          </Button>
        </div>
      </Modal>

      {/* Reservations */}
      <Modal open={resOpen} onClose={() => setResOpen(false)} title="Reservas de hoje" wide>
        <div className="space-y-4">
          <ul className="max-h-56 divide-y divide-mist-100 overflow-y-auto dark:divide-graphite-700">
            {reservations.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <Clock className="h-4 w-4 shrink-0 text-graphite-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">
                    {fmtTime(r.reserved_for)} · {r.customer_record_name ?? r.customer_name ?? "Cliente"} · {r.party_size}p
                    {r.table_name ? ` · mesa ${r.table_name}` : ""}
                  </p>
                  {r.note && <p className="truncate text-[10px] text-graphite-400">{r.note}</p>}
                </div>
                <Badge tone={r.status === "booked" ? "info" : r.status === "seated" ? "accent" : r.status === "completed" ? "success" : r.status === "no_show" ? "danger" : "neutral"}>
                  {r.status}
                </Badge>
                {r.status === "booked" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setResStatus(r.id, "seated")}>Sentar</Button>
                    <Button variant="ghost" size="sm" onClick={() => setResStatus(r.id, "no_show")}>Falta</Button>
                    <Button variant="ghost" size="sm" onClick={() => setResStatus(r.id, "cancelled")}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
            {reservations.length === 0 && <li className="py-6 text-center text-xs text-graphite-400">Sem reservas para hoje.</li>}
          </ul>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-mist-200 p-3 md:grid-cols-3 dark:border-graphite-600">
            <Field label="Nome" required>
              <Input value={resForm.name} onChange={(e) => setResForm({ ...resForm, name: e.target.value })} />
            </Field>
            <Field label="Telefone">
              <Input value={resForm.phone} onChange={(e) => setResForm({ ...resForm, phone: e.target.value })} />
            </Field>
            <Field label="Pessoas">
              <Input type="number" min={1} value={resForm.guests} onChange={(e) => setResForm({ ...resForm, guests: e.target.value })} />
            </Field>
            <Field label="Data/hora" required>
              <Input type="datetime-local" value={resForm.when} onChange={(e) => setResForm({ ...resForm, when: e.target.value })} />
            </Field>
            <Field label="Mesa (opcional)">
              <Select value={resForm.tableId} onChange={(e) => setResForm({ ...resForm, tableId: e.target.value })}>
                <option value="">Sem mesa atribuída</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                variant="accent"
                className="w-full"
                disabled={!resForm.name.trim() || !resForm.when}
                onClick={async () => {
                  try {
                    await api("/api/restaurant/reservations", {
                      method: "POST",
                      body: {
                        action: "create",
                        branchId,
                        customerName: resForm.name.trim(),
                        phone: resForm.phone || null,
                        partySize: Math.max(1, parseInt(resForm.guests) || 1),
                        reservedFor: new Date(resForm.when).getTime(),
                        tableId: resForm.tableId || null,
                        note: resForm.notes || null,
                      },
                    });
                    setResForm({ name: "", phone: "", guests: "2", when: "", tableId: "", notes: "" });
                    setResOpen(false);
                    setResOpen(true);
                    toast.success("Reserva criada");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Falha ao criar reserva");
                  }
                }}
              >
                Criar reserva
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Bill */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        totalCents={openTotal}
        methods={methods}
        currency={currency}
        offline={false}
        busy={payBusy}
        onSubmit={(payments) => {
          if (!pending) return;
          setPending({ ...pending, payments });
          payBill(payments);
        }}
      />
      <SupervisorModal
        open={supervisor !== null}
        onClose={() => { setSupervisor(null); setPending(null); }}
        reason={supervisor?.reason ?? ""}
        busy={payBusy}
        onConfirm={(sup) => {
          setSupervisor(null);
          if (pending) payBill(pending.payments.length ? pending.payments : [], sup);
        }}
      />
      <ReceiptModal vm={receipt} onClose={() => setReceipt(null)} onNewSale={() => setReceipt(null)} canReprint={workspace.can("pos.reprint")} />
    </>
  );

  function setResStatus(id: string, status: string) {
    api("/api/restaurant/reservations", { method: "POST", body: { action: "status", reservationId: id, status } })
      .then(() => {
        setReservations((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
        loadTables();
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha"));
  }
}
