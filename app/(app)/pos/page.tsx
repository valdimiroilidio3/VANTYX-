"use client";

/**
 * POS — checkout universal (modo retalho, prioridade Supermercado).
 * Preços: o servidor é a autoridade (o checkout re-valida tudo).
 * Offline: vendas vão para fila local; pagamentos NUNCA são confirmados
 * offline — o documento só existe após validação no servidor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Barcode,
  CloudOff,
  CloudUpload,
  Minus,
  PackageOpen,
  PauseCircle,
  Percent,
  PlayCircle,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  User,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm } from "@/components/ui";
import { Badge, Button, EmptyState, Field, Input, Modal } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtMoney, fmtQty } from "@/lib/format";
import {
  cartTotals,
  lineFromResult,
  lineTotalCents,
  loadOutbox,
  newClientRef,
  newLineId,
  saveOutbox,
  toCheckoutLines,
  type CartLine,
  type EmbeddedInfo,
  type OutboxEntry,
  type PosSearchResult,
} from "@/lib/pos/cart";
import { PaymentModal, type PaymentDraft, type PaymentMethodOption } from "@/components/pos/payment-modal";
import { ProductImage } from "@/components/product-image";
import { SupervisorModal } from "@/components/pos/supervisor-modal";
import { ReceiptModal, type ReceiptVM } from "@/components/pos/receipt-modal";

interface CheckoutResultVM {
  saleId: string;
  documentNumber: string | null;
  totalCents: number;
  changeCents: number;
  status: string;
  loyaltyEarned: number;
  replayed: boolean;
}

interface HeldRow {
  id: string;
  label: string | null;
  customer_id: string | null;
  user_name?: string | null;
  updated_at: number;
  cart: string;
}

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
}

interface OpenSessionRow {
  id: string;
  terminal_id: string | null;
  status: string;
}

export default function PosPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;

  const branchId = workspace.branchId;
  const terminalId = workspace.terminalId;

  /* ------------------------- state ------------------------- */
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosSearchResult[]>([]);
  const [embedded, setEmbedded] = useState<EmbeddedInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldRows, setHeldRows] = useState<HeldRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [openSession, setOpenSession] = useState<OpenSessionRow | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [weightFor, setWeightFor] = useState<{ result: PosSearchResult; embedded: EmbeddedInfo | null } | null>(null);
  const [weightGrams, setWeightGrams] = useState("500");
  const [discountFor, setDiscountFor] = useState<CartLine | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [discountMode, setDiscountMode] = useState<"cents" | "pct">("pct");
  const [discountReason, setDiscountReason] = useState("");
  const [supervisor, setSupervisor] = useState<{ reason: string } | null>(null);
  const [pending, setPending] = useState<{ payments: PaymentDraft[]; clientRef: string; idempotencyKey: string } | null>(null);
  const [receipt, setReceipt] = useState<ReceiptVM | null>(null);
  const [online, setOnline] = useState(true);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ------------------------- loaders ------------------------- */
  useEffect(() => {
    api<PaymentMethodOption[]>("/api/cash/methods")
      .then(setMethods)
      .catch(() => setMethods([]));
    setOutbox(loadOutbox());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!branchId || !workspace.can("cash.view")) return;
    api<{ rows: OpenSessionRow[]; total: number }>("/api/cash/sessions", {
      query: { branchId, status: "open", limit: 10 },
    })
      .then((data) => {
        const rows = data.rows ?? [];
        const mine = terminalId ? rows.find((r) => r.terminal_id === terminalId) : null;
        setOpenSession(mine ?? rows[0] ?? null);
      })
      .catch(() => setOpenSession(null));
  }, [branchId, terminalId, workspace]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setEmbedded(null);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api<{ results: PosSearchResult[]; embedded: EmbeddedInfo | null }>("/api/pos/search", {
          query: { q, branchId: branchId ?? undefined, limit: 18 },
        });
        setResults(data.results);
        setEmbedded(data.embedded);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, branchId]);

  const totals = useMemo(() => cartTotals(lines), [lines]);

  /* ------------------------- cart ops ------------------------- */
  const addLine = useCallback((line: CartLine) => {
    setLines((list) => {
      // Merge only plain unit lines without embedded/discount/notes
      const mergeable = !line.embeddedKind && !line.notes && line.saleMode === "units";
      const idx = mergeable
        ? list.findIndex(
            (l) => l.productId === line.productId && l.variantId === line.variantId && !l.embeddedKind && !l.notes && !l.discountCents,
          )
        : -1;
      if (idx >= 0) {
        const copy = [...list];
        copy[idx] = { ...copy[idx]!, qtyMilli: copy[idx]!.qtyMilli + line.qtyMilli };
        return copy;
      }
      return [...list, line];
    });
    setQuery("");
    setResults([]);
    setEmbedded(null);
    searchRef.current?.focus();
  }, []);

  function selectResult(result: PosSearchResult, emb: EmbeddedInfo | null) {
    if (result.saleMode === "weight" && !(emb?.kind === "weight" || emb?.kind === "price")) {
      setWeightFor({ result, embedded: emb });
      setWeightGrams("500");
      return;
    }
    addLine(lineFromResult(result, { embedded: emb }));
  }

  function confirmWeight() {
    if (!weightFor) return;
    const grams = Math.round(parseFloat(weightGrams.replace(",", ".")) * 1000) / 1000;
    if (!Number.isFinite(grams) || grams <= 0) {
      toast.error("Peso inválido");
      return;
    }
    addLine(lineFromResult(weightFor.result, { weightGrams: Math.round(grams * 1000), embedded: weightFor.embedded }));
    setWeightFor(null);
  }

  function updateLine(lineId: string, patch: Partial<CartLine>) {
    setLines((list) => list.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  }

  function changeQty(line: CartLine, deltaMilli: number) {
    const next = line.qtyMilli + deltaMilli;
    if (next <= 0) {
      setLines((list) => list.filter((l) => l.lineId !== line.lineId));
      return;
    }
    updateLine(line.lineId, { qtyMilli: next });
  }

  function applyLineDiscount() {
    if (!discountFor) return;
    const gross = lineTotalCents({ ...discountFor, discountCents: 0 });
    let cents: number;
    if (discountMode === "pct") {
      const pct = parseFloat(discountValue.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        toast.error("Percentagem inválida (1–100).");
        return;
      }
      cents = Math.round((gross * pct) / 100);
    } else {
      cents = Math.round(parseFloat(discountValue.replace(",", ".")) * 100);
      if (!Number.isFinite(cents) || cents <= 0 || cents > gross) {
        toast.error("Valor de desconto inválido.");
        return;
      }
    }
    updateLine(discountFor.lineId, { discountCents: cents, discountReason: discountReason || undefined });
    setDiscountFor(null);
    setDiscountValue("");
    setDiscountReason("");
  }

  /* ------------------------- held sales ------------------------- */
  async function loadHeld() {
    try {
      const rows = await api<HeldRow[]>("/api/pos/held", { query: { branchId: branchId ?? undefined } });
      setHeldRows(rows);
    } catch {
      setHeldRows([]);
    }
  }

  async function holdCart() {
    if (!lines.length || !branchId) return;
    try {
      await api("/api/pos/held", {
        method: "POST",
        body: {
          branchId,
          terminalId,
          customerId,
          label: customerName ?? `Venda ${new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`,
          cart: { lines, customerId, customerName },
        },
      });
      setLines([]);
      setCustomerId(null);
      setCustomerName(null);
      toast.success("Venda suspensa", "Retome em “Suspensas”.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao suspender");
    }
  }

  async function resumeHeld(row: HeldRow) {
    try {
      const data = await api<{ cart: unknown; customerId: string | null }>("/api/pos/held/" + row.id, {
        method: "POST",
        body: {},
      });
      const cart = data.cart as { lines?: CartLine[]; customerName?: string | null };
      const restored = (cart?.lines ?? []).map((l) => ({ ...l, lineId: newLineId() }));
      setLines((list) => [...list, ...restored]);
      if (data.customerId) {
        setCustomerId(data.customerId);
        setCustomerName(cart?.customerName ?? "Cliente");
      }
      setHeldOpen(false);
      toast.success("Venda retomada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao retomar");
    }
  }

  /* ------------------------- checkout ------------------------- */
  function queueOffline(body: Record<string, unknown>, clientRef: string, idempotencyKey: string) {
    const entry: OutboxEntry = {
      id: idempotencyKey,
      createdAt: Date.now(),
      branchId: String(body.branchId ?? branchId ?? ""),
      terminalId: terminalId,
      clientRef,
      idempotencyKey,
      payload: body,
      status: "queued",
      attempts: 0,
    };
    const next = [...loadOutbox(), entry];
    saveOutbox(next);
    setOutbox(next);
    setLines([]);
    setCustomerId(null);
    setCustomerName(null);
    setPayOpen(false);
    toast.warning(
      "Sem ligação — venda em fila",
      "O pagamento NÃO está confirmado. O documento só será emitido quando a sincronização for validada pelo servidor.",
    );
  }

  async function doCheckout(payments: PaymentDraft[], supervisorPin?: { userId: string; pin: string }) {
    if (!branchId) {
      toast.error("Selecione uma filial para vender.");
      return;
    }
    const clientRef = pending?.clientRef ?? newClientRef();
    const idempotencyKey = pending?.idempotencyKey ?? `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    if (!pending) setPending({ payments, clientRef, idempotencyKey });

    const body: Record<string, unknown> = {
      branchId,
      terminalId,
      cashSessionId: openSession?.id ?? null,
      customerId,
      channel: "in_store",
      clientRef,
      idempotencyKey,
      lines: toCheckoutLines(lines),
      orderDiscountCents: 0,
      payments: payments.map((p) => ({
        methodKey: p.methodKey,
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents,
        status: "confirmed",
      })),
      loyaltyEarn: Boolean(customerId),
      ...(supervisorPin ? { supervisor: supervisorPin } : {}),
    };

    setPayBusy(true);
    try {
      const result = await api<CheckoutResultVM>("/api/pos/checkout", { method: "POST", body });
      setPayOpen(false);
      setPending(null);
      setLines([]);
      setCustomerId(null);
      setCustomerName(null);
      if (result.replayed) {
        toast.info("Venda já registada", `Duplicação evitada (idempotência). Documento ${result.documentNumber ?? "—"}.`);
      }
      // Receipt (permission-gated; fallback to summary)
      try {
        const vm = await api<ReceiptVM>(`/api/sales/${result.saleId}/receipt`);
        setReceipt(vm);
      } catch {
        toast.success("Venda concluída", `${result.documentNumber ?? "documento interno"} · ${fmtMoney(result.totalCents, currency)}${result.changeCents > 0 ? ` · troco ${fmtMoney(result.changeCents, currency)}` : ""}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        setSupervisor({ reason: err.body.message });
        setPayOpen(false);
        return;
      }
      if (err instanceof ApiClientError) {
        // The server answered → this is a business rejection, never queue it
        toast.error("Venda recusada", err.body.message);
        setPending(null);
        return;
      }
      // Network failure (fetch rejected) → offline queue.
      // Payments are NEVER confirmed locally; the document only exists
      // after the server validates the queued operation.
      queueOffline(body, clientRef, idempotencyKey);
      setPending(null);
    } finally {
      setPayBusy(false);
    }
  }

  async function syncOutbox() {
    setSyncing(true);
    const entries = loadOutbox();
    const remaining: OutboxEntry[] = [];
    let synced = 0;
    for (const entry of entries) {
      try {
        await api("/api/pos/checkout", { method: "POST", body: entry.payload });
        synced += 1;
      } catch (err) {
        remaining.push({
          ...entry,
          attempts: entry.attempts + 1,
          status: "failed",
          lastError: err instanceof ApiClientError ? err.body.message : "Falha de rede",
        });
      }
    }
    saveOutbox(remaining);
    setOutbox(remaining);
    setSyncing(false);
    if (synced) toast.success(`${synced} venda(s) sincronizada(s)`, "Documentos emitidos pelo servidor.");
    if (remaining.length) toast.error(`${remaining.length} venda(s) em fila`, remaining[0]?.lastError ?? "Verifique os erros.");
  }

  /* ------------------------- keyboard ------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2" && lines.length) {
        e.preventDefault();
        setPayOpen(true);
      }
      if (e.key === "F4" && lines.length && workspace.can("pos.hold")) {
        e.preventDefault();
        holdCart();
      }
      if (e.key === "Escape") {
        setQuery("");
        searchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, workspace]);

  /* ------------------------- render ------------------------- */
  const embeddedTarget = embedded?.productId
    ? results.find((r) => r.productId === embedded.productId) ?? null
    : null;

  return (
    <>
      <PageHeader
        title="Ponto de Venda"
        subtitle={`${workspace.org.posMode === "hospitality" ? "Modo hospitalidade" : "Modo retalho"} · ${terminalId ? workspace.terminals.find((t) => t.id === terminalId)?.name ?? "terminal" : "sem terminal selecionado"}${openSession ? " · caixa aberta" : ""}`}
        actions={
          <>
            {!online && (
              <Badge tone="warning">
                <CloudOff className="mr-1 inline h-3 w-3" /> offline
              </Badge>
            )}
            {outbox.length > 0 && (
              <Button variant="secondary" size="sm" loading={syncing} onClick={syncOutbox} icon={<CloudUpload className="h-3.5 w-3.5" />}>
                Sincronizar ({outbox.length})
              </Button>
            )}
            {workspace.can("pos.hold") && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setHeldOpen(true);
                  loadHeld();
                }}
                icon={<PauseCircle className="h-3.5 w-3.5" />}
              >
                Suspensas
              </Button>
            )}
          </>
        }
      />

      {outbox.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-warning">
          <CloudOff className="h-3.5 w-3.5" />
          {outbox.length} venda(s) em fila de sincronização — pagamentos não confirmados localmente.
          <button className="ml-auto font-semibold underline" onClick={syncOutbox} disabled={syncing}>
            Sincronizar agora
          </button>
        </div>
      )}

      <div className="grid h-[calc(100vh-7.5rem)] grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_25rem]">
        {/* -------- LEFT: search & catalog -------- */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-graphite-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const q = query.trim();
                if (!q) return;
                const exact = results.find((r) => r.barcode === q);
                if (exact) {
                  selectResult(exact, null);
                  return;
                }
                if (embeddedTarget && embedded) {
                  selectResult(embeddedTarget, embedded);
                  return;
                }
                if (results.length === 1) selectResult(results[0]!, null);
              }}
              placeholder="Ler código de barras ou pesquisar produto… (Enter adiciona; F2 paga; Esc limpa)"
              className="w-full rounded-lg border border-mist-200 bg-white py-3 pl-11 pr-10 text-sm outline-none transition-colors focus:border-lime-brand dark:border-graphite-600 dark:bg-graphite-800"
              autoFocus
              autoComplete="off"
              aria-label="Pesquisa de produtos"
            />
            {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-graphite-400">…</span>}
          </div>

          {embedded && embeddedTarget && (
            <button
              onClick={() => selectResult(embeddedTarget, embedded)}
              className="flex items-center gap-3 rounded-lg border border-lime-brand/50 bg-lime-brand/10 px-4 py-3 text-left"
            >
              <Barcode className="h-5 w-5 shrink-0 text-lime-dim dark:text-lime-brand" />
              <span>
                <span className="block text-sm font-semibold">
                  Etiqueta de balança: {embeddedTarget.name}
                </span>
                <span className="block text-xs text-graphite-400">
                  {embedded.kind === "price"
                    ? `Preço impresso ${fmtMoney(embedded.value, currency)} — o valor da etiqueta é respeitado.`
                    : `Peso impresso ${(embedded.value / 1000).toFixed(3).replace(".", ",")} kg × ${fmtMoney(embeddedTarget.priceCents, currency)}/${embeddedTarget.unit}`}
                </span>
              </span>
              <Plus className="ml-auto h-5 w-5 text-lime-brand" />
            </button>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-mist-200 bg-white p-2 dark:border-graphite-700 dark:bg-graphite-850">
            {results.length === 0 && !query.trim() && (
              <EmptyState
                title="Pronto para vender"
                message="Leia um código de barras, pesquise por nome/SKU ou retome uma venda suspensa."
                icon={<ShoppingCart className="h-8 w-8" />}
              />
            )}
            {results.length === 0 && query.trim() && !searching && (
              <EmptyState title="Sem resultados" message={`Nada encontrado para “${query}”.`} icon={<Search className="h-8 w-8" />} />
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {results.map((r) => {
                const key = `${r.productId}:${r.variantId ?? ""}`;
                const lowStock = r.trackStock && r.stockMilli != null && r.stockMilli <= 0;
                return (
                  <button
                    key={key}
                    onClick={() => selectResult(r, null)}
                    className={clsx(
                      "hover-lift group rounded-2xl border p-2.5 text-left",
                      lowStock
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-mist-200 hover:border-lime-brand dark:border-graphite-600",
                    )}
                  >
                    <ProductImage src={r.image} name={r.variantLabel ?? r.name} className="mb-2 h-14 w-full" rounded="rounded-lg" />
                    <span className="flex items-start justify-between gap-1">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{r.name}</span>
                        {r.variantLabel && <span className="block truncate text-[10px] text-graphite-400">{r.variantLabel}</span>}
                      </span>
                      {r.saleMode === "weight" && <Badge tone="info">peso</Badge>}
                    </span>
                    <span className="mt-1.5 block font-mono text-sm font-bold tabular-nums text-lime-dim dark:text-lime-brand">
                      {fmtMoney(r.priceCents, currency)}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between text-[10px] text-graphite-400">
                      <span className="truncate font-mono">{r.sku}</span>
                      {r.trackStock && r.stockMilli != null && (
                        <span className={clsx("shrink-0 tabular-nums", lowStock && "font-semibold text-warning")}>
                          {fmtQty(r.stockMilli, r.unit)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* -------- RIGHT: cart -------- */}
        <div className="flex min-h-0 flex-col rounded-lg border border-mist-200 bg-white dark:border-graphite-700 dark:bg-graphite-850">
          {/* customer */}
          <div className="flex items-center gap-2 border-b border-mist-200 px-3 py-2 dark:border-graphite-700">
            <User className="h-4 w-4 shrink-0 text-graphite-400" />
            {customerId ? (
              <>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{customerName}</span>
                <button className="text-[11px] text-graphite-400 hover:text-danger" onClick={() => { setCustomerId(null); setCustomerName(null); }}>
                  remover
                </button>
              </>
            ) : workspace.can("customers.view") ? (
              <button className="text-xs text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => setCustomerOpen(true)}>
                Associar cliente (loyalty / conta corrente)…
              </button>
            ) : (
              <span className="text-xs text-graphite-400">Venda anónima</span>
            )}
          </div>

          {/* lines */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="text-xs text-graphite-400">
                  <PackageOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Carrinho vazio.
                  <br />
                  Os artigos aparecem aqui ao ler/pesquisar.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                {lines.map((l) => (
                  <li key={l.lineId} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">
                          {l.name}
                          {l.variantLabel ? <span className="font-normal text-graphite-400"> · {l.variantLabel}</span> : null}
                        </p>
                        <p className="text-[10px] text-graphite-400">
                          {fmtMoney(l.priceCents, currency)}/{l.unit}
                          {l.embeddedKind && <Badge tone="info" className="ml-1">etiqueta {l.embeddedKind === "price" ? "preço" : "peso"}</Badge>}
                          {l.discountCents > 0 && (
                            <span className="ml-1 text-success">−{fmtMoney(l.discountCents, currency)}{l.discountReason ? ` (${l.discountReason})` : ""}</span>
                          )}
                          {l.trackStock && l.stockMilli != null && l.qtyMilli > l.stockMilli && (
                            <span className="ml-1 text-warning">stock {fmtQty(l.stockMilli, l.unit)}</span>
                          )}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-xs font-bold tabular-nums">{fmtMoney(lineTotalCents(l), currency)}</p>
                      <button
                        className="shrink-0 rounded p-0.5 text-graphite-400 hover:text-danger"
                        onClick={() => setLines((list) => list.filter((x) => x.lineId !== l.lineId))}
                        aria-label={`Remover ${l.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex items-center overflow-hidden rounded-md border border-mist-200 dark:border-graphite-600">
                        <button className="px-2 py-1 text-graphite-400 hover:bg-mist-100 dark:hover:bg-graphite-700" onClick={() => changeQty(l, -1000)} aria-label="Diminuir">
                          <Minus className="h-3 w-3" />
                        </button>
                        {l.saleMode === "weight" ? (
                          <input
                            className="w-20 bg-transparent px-1 py-1 text-center font-mono text-xs tabular-nums outline-none"
                            value={(l.qtyMilli / 1000).toFixed(3)}
                            onChange={(e) => {
                              const g = Math.round(parseFloat(e.target.value.replace(",", ".")) * 1000);
                              if (Number.isFinite(g) && g > 0) updateLine(l.lineId, { qtyMilli: g });
                            }}
                            aria-label="Quantidade"
                          />
                        ) : (
                          <span className="min-w-8 px-1 py-1 text-center font-mono text-xs tabular-nums">{fmtQty(l.qtyMilli)}</span>
                        )}
                        <button className="px-2 py-1 text-graphite-400 hover:bg-mist-100 dark:hover:bg-graphite-700" onClick={() => changeQty(l, 1000)} aria-label="Aumentar">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      {workspace.can("pos.line_discount") && (
                        <button
                          className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand"
                          onClick={() => { setDiscountFor(l); setDiscountValue(""); setDiscountMode("pct"); setDiscountReason(""); }}
                          aria-label="Desconto de linha"
                        >
                          <Percent className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* totals & actions */}
          <div className="border-t border-mist-200 p-3 dark:border-graphite-700">
            <div className="mb-2 space-y-1 text-xs">
              {totals.discountCents > 0 && (
                <p className="flex justify-between text-graphite-400">
                  <span>Descontos</span>
                  <span className="font-mono tabular-nums text-success">−{fmtMoney(totals.discountCents, currency)}</span>
                </p>
              )}
              <p className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">TOTAL</span>
                <span className="font-mono text-2xl font-bold tabular-nums">{fmtMoney(totals.totalCents, currency)}</span>
              </p>
              <p className="text-right text-[10px] text-graphite-400">
                {totals.linesCount} linha(s) · {fmtQty(totals.totalQtyMilli)} artigo(s)
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                disabled={!lines.length}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Limpar carrinho",
                    message: "Remover todas as linhas da venda atual?",
                    confirmLabel: "Limpar",
                    danger: true,
                  });
                  if (ok) setLines([]);
                }}
                icon={<X className="h-4 w-4" />}
              >
                Limpar
              </Button>
              {workspace.can("pos.hold") && (
                <Button variant="secondary" disabled={!lines.length} onClick={holdCart} icon={<PauseCircle className="h-4 w-4" />}>
                  Suspender
                </Button>
              )}
              <Button variant="accent" disabled={!lines.length} onClick={() => setPayOpen(true)} icon={<ShoppingCart className="h-4 w-4" />}>
                Pagar (F2)
              </Button>
            </div>
            {!terminalId && (
              <p className="mt-2 text-[10px] leading-tight text-warning">
                Sem terminal selecionado — escolha o terminal na barra superior para associar vendas e caixa.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* -------- modals -------- */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        totalCents={totals.totalCents}
        methods={methods}
        currency={currency}
        offline={!online}
        busy={payBusy}
        onSubmit={(payments) => doCheckout(payments)}
      />

      <SupervisorModal
        open={supervisor !== null}
        onClose={() => { setSupervisor(null); setPending(null); }}
        reason={supervisor?.reason ?? ""}
        busy={payBusy}
        onConfirm={(sup) => {
          setSupervisor(null);
          if (pending) doCheckout(pending.payments, sup);
        }}
      />

      <ReceiptModal
        vm={receipt}
        onClose={() => setReceipt(null)}
        onNewSale={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
        canReprint={workspace.can("pos.reprint")}
      />

      {/* weight prompt */}
      <Modal open={weightFor !== null} onClose={() => setWeightFor(null)} title={`Peso — ${weightFor?.result.name ?? ""}`}>
        <div className="space-y-4">
          <Field label="Peso (kg)" required>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={weightGrams}
              onChange={(e) => setWeightGrams(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && confirmWeight()}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {["0,250", "0,500", "0,750", "1,000"].map((v) => (
              <button key={v} className="rounded-md border border-mist-200 px-2.5 py-1 text-xs hover:border-lime-brand dark:border-graphite-600" onClick={() => setWeightGrams(v)}>
                {v} kg
              </button>
            ))}
          </div>
          {weightFor && (
            <p className="text-xs text-graphite-400">
              Preço: {fmtMoney(weightFor.result.priceCents, currency)}/{weightFor.result.unit} — total recalculado no servidor.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWeightFor(null)}>Cancelar</Button>
            <Button variant="accent" onClick={confirmWeight}>Adicionar</Button>
          </div>
        </div>
      </Modal>

      {/* line discount */}
      <Modal open={discountFor !== null} onClose={() => setDiscountFor(null)} title="Desconto de linha">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={discountMode === "pct" ? "accent" : "secondary"} size="sm" onClick={() => setDiscountMode("pct")}>
              % percentagem
            </Button>
            <Button variant={discountMode === "cents" ? "accent" : "secondary"} size="sm" onClick={() => setDiscountMode("cents")}>
              € valor
            </Button>
          </div>
          <Field label={discountMode === "pct" ? "Percentagem (1–100)" : `Valor em ${currency}`} required>
            <Input value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} autoFocus inputMode="decimal" />
          </Field>
          <Field label="Motivo (registado na venda)" hint="Regras podem exigir aprovação acima do limite da função.">
            <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Ex.: avaria de embalagem" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDiscountFor(null)}>Cancelar</Button>
            <Button variant="accent" onClick={applyLineDiscount}>Aplicar</Button>
          </div>
        </div>
      </Modal>

      {/* held sales */}
      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title="Vendas suspensas" wide>
        {heldRows.length === 0 ? (
          <EmptyState title="Nenhuma venda suspensa" message="Suspenda vendas com F4 para atender outro cliente." icon={<PauseCircle className="h-8 w-8" />} />
        ) : (
          <ul className="divide-y divide-mist-100 dark:divide-graphite-700">
            {heldRows.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-1 py-2.5">
                <PlayCircle className="h-4 w-4 shrink-0 text-graphite-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{h.label ?? "Venda suspensa"}</p>
                  <p className="text-[10px] text-graphite-400">
                    {h.user_name ?? "—"} · {new Date(h.updated_at).toLocaleString("pt-PT")}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => resumeHeld(h)}>Retomar</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await api("/api/pos/held/" + h.id, { method: "DELETE" });
                    loadHeld();
                  }}
                  aria-label="Eliminar suspensa"
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* customer picker */}
      <Modal open={customerOpen} onClose={() => setCustomerOpen(false)} title="Associar cliente">
        <div className="space-y-3">
          <Field label="Pesquisar">
            <Input
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Nome, email, telefone ou NIF…"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key !== "Enter") return;
                const data = await api<{ customers?: CustomerRow[] } | CustomerRow[]>("/api/customers", {
                  query: { search: customerQuery, limit: 10 },
                });
                setCustomerResults(Array.isArray(data) ? data : (data.customers ?? []));
              }}
            />
          </Field>
          <ul className="max-h-52 divide-y divide-mist-100 overflow-y-auto dark:divide-graphite-700">
            {customerResults.map((c) => (
              <li key={c.id}>
                <button
                  className="w-full px-1 py-2 text-left hover:bg-mist-100 dark:hover:bg-graphite-700"
                  onClick={() => {
                    setCustomerId(c.id);
                    setCustomerName(c.name);
                    setCustomerOpen(false);
                  }}
                >
                  <span className="block text-xs font-semibold">{c.name}</span>
                  <span className="block text-[10px] text-graphite-400">
                    {[c.email, c.phone, c.tax_id].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {customerResults.length === 0 && (
              <li className="py-4 text-center text-[11px] text-graphite-400">Pesquise e pressione Enter.</li>
            )}
          </ul>
          {workspace.can("customers.manage") && (
            <div className="flex items-end gap-2 border-t border-mist-200 pt-3 dark:border-graphite-700">
              <div className="flex-1">
                <Field label="Criar cliente rápido">
                  <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Nome" />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={!newCustomerName.trim()}
                onClick={async () => {
                  try {
                    const res = await api<{ customerId: string }>("/api/customers", {
                      method: "POST",
                      body: { name: newCustomerName.trim() },
                    });
                    setCustomerId(res.customerId);
                    setCustomerName(newCustomerName.trim());
                    setNewCustomerName("");
                    setCustomerOpen(false);
                    toast.success("Cliente criado");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Falha ao criar cliente");
                  }
                }}
              >
                Criar
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
