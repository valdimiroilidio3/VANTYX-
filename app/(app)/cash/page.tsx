"use client";

/**
 * Caixa — sessões por terminal com abertura (fundo), entradas/saídas
 * auditadas, contagem no fecho e diferença calculada pelo servidor
 * (fórmula: fundo + vendas numerário − troco − reembolsos numerário
 * + entradas − saídas).
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Lock,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney, fmtTime } from "@/lib/format";

interface SessionRow {
  id: string;
  branch_id: string;
  branch_name?: string;
  terminal_id: string;
  terminal_name?: string;
  status: "open" | "closed";
  opening_float_cents: number;
  opened_by_name?: string | null;
  opened_at: number;
  closed_at: number | null;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  difference_cents: number | null;
  closing_note: string | null;
  totals: string | null;
}

interface SessionCounters {
  salesCount: number;
  grossCents: number;
  netCents: number;
  taxCents: number;
  discountCents: number;
  returnsCents: number;
  byMethod: Record<string, number>;
  cashSalesCents: number;
  cashReturnsCents: number;
  movementsInCents: number;
  movementsOutCents: number;
  expectedCashCents: number;
}

interface MovementRow {
  id: string;
  kind: "in" | "out";
  amount_cents: number;
  reason_code: string;
  note: string | null;
  user_name?: string | null;
  created_at: number;
}

interface SessionDetail {
  session: SessionRow;
  counters: SessionCounters;
  movements: MovementRow[];
}

const PAGE_SIZE = 25;

export default function CashPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;

  const [rows, setRows] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [openModal, setOpenModal] = useState(false);
  const [openTerminal, setOpenTerminal] = useState("");
  const [openFloat, setOpenFloat] = useState("50");
  const [openShift, setOpenShift] = useState("");
  const [openBusy, setOpenBusy] = useState(false);

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [movOpen, setMovOpen] = useState<{ kind: "in" | "out" } | null>(null);
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("suprimento");
  const [movNote, setMovNote] = useState("");

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeCounted, setCloseCounted] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: SessionRow[]; total: number }>("/api/cash/sessions", {
        query: {
          branchId: workspace.branchId ?? undefined,
          status: statusFilter || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar sessões");
    } finally {
      setLoading(false);
    }
  }, [workspace.branchId, statusFilter, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const branchTerminals = workspace.terminals.filter((t) => t.branchId === workspace.branchId);
  const openSessions = rows.filter((r) => r.status === "open");

  async function openDetail(id: string) {
    try {
      const d = await api<SessionDetail>(`/api/cash/sessions/${id}`);
      setDetail(d);
      setDetailOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir sessão");
    }
  }

  async function submitOpen() {
    if (!workspace.branchId || !openTerminal) return;
    const floatCents = Math.round(parseFloat(openFloat.replace(",", ".")) * 100);
    if (!Number.isFinite(floatCents) || floatCents < 0) {
      toast.error("Fundo inicial inválido.");
      return;
    }
    setOpenBusy(true);
    try {
      await api("/api/cash/sessions", {
        method: "POST",
        body: {
          branchId: workspace.branchId,
          terminalId: openTerminal,
          openingFloatCents: floatCents,
          ...(openShift.trim() ? { shiftLabel: openShift.trim() } : {}),
        },
      });
      setOpenModal(false);
      toast.success("Caixa aberta", "Sessão iniciada — as vendas em numerário ficam associadas.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao abrir caixa");
    } finally {
      setOpenBusy(false);
    }
  }

  async function submitMovement() {
    if (!detail || !movOpen) return;
    const cents = Math.round(parseFloat(movAmount.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error("Valor inválido.");
      return;
    }
    try {
      await api(`/api/cash/sessions/${detail.session.id}`, {
        method: "POST",
        body: {
          action: "movement",
          kind: movOpen.kind,
          amountCents: cents,
          reasonCode: movReason,
          note: movNote || undefined,
        },
      });
      setMovOpen(null);
      setMovAmount("");
      setMovNote("");
      toast.success(movOpen.kind === "in" ? "Entrada registada" : "Saída registada");
      openDetail(detail.session.id);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha no movimento");
    }
  }

  async function submitClose() {
    if (!detail) return;
    const counted = Math.round(parseFloat(closeCounted.replace(",", ".")) * 100);
    if (!Number.isFinite(counted) || counted < 0) {
      toast.error("Valor contado inválido.");
      return;
    }
    const expected = detail.counters.expectedCashCents;
    const diff = counted - expected;
    if (diff !== 0) {
      const ok = await confirm({
        title: "Diferença de caixa",
        message: `Contou ${fmtMoney(counted, currency)} mas o sistema espera ${fmtMoney(expected, currency)} (diferença ${diff > 0 ? "+" : ""}${fmtMoney(diff, currency)}). A diferença fica registada e auditada. Fechar mesmo assim?`,
        confirmLabel: "Fechar com diferença",
        danger: true,
      });
      if (!ok) return;
    }
    setCloseBusy(true);
    try {
      const res = await api<{ differenceCents: number }>(`/api/cash/sessions/${detail.session.id}`, {
        method: "POST",
        body: { action: "close", countedCashCents: counted, note: closeNote || undefined },
      });
      setCloseOpen(false);
      setDetailOpen(false);
      toast.success(
        "Caixa fechada",
        res.differenceCents === 0
          ? "Reconciliação exata."
          : `Diferença registada: ${res.differenceCents > 0 ? "+" : ""}${fmtMoney(res.differenceCents, currency)}.`,
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao fechar caixa");
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Caixa & Reconciliação"
        subtitle={`${openSessions.length} sessão(ões) aberta(s) · histórico de ${total} sessões`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />}>
              Atualizar
            </Button>
            {workspace.can("cash.open") && (
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setOpenTerminal(workspace.terminalId ?? branchTerminals[0]?.id ?? "");
                  setOpenFloat("50");
                  setOpenShift("");
                  setOpenModal(true);
                }}
                icon={<PlayCircle className="h-3.5 w-3.5" />}
              >
                Abrir caixa
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <Select className="w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} aria-label="Estado">
          <option value="">Todas</option>
          <option value="open">Abertas</option>
          <option value="closed">Fechadas</option>
        </Select>
        {!workspace.branchId && <p className="text-xs text-warning">Selecione uma filial para filtrar.</p>}
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhuma sessão de caixa"
            message="Abra uma caixa num terminal para registar vendas em numerário, entradas e saídas."
            icon={<Banknote className="h-8 w-8" />}
          />
        ) : (
          <>
            <ul className="space-y-2">
              {rows.map((s) => {
                const diffTone =
                  s.status === "closed" && s.difference_cents != null
                    ? s.difference_cents === 0
                      ? "text-success"
                      : Math.abs(s.difference_cents) > 500
                        ? "text-danger"
                        : "text-warning"
                    : "";
                return (
                  <li key={s.id}>
                    <button onClick={() => openDetail(s.id)} className="card flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:border-lime-brand/50">
                      <Badge tone={s.status === "open" ? "success" : "neutral"}>
                        {s.status === "open" ? "aberta" : "fechada"}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {s.terminal_name ?? s.terminal_id.slice(0, 8)}
                          <span className="font-normal text-graphite-400"> · {s.branch_name}</span>
                        </span>
                        <span className="block text-[11px] text-graphite-400">
                          aberta {fmtDateTime(s.opened_at)} por {s.opened_by_name ?? "—"}
                          {s.closed_at ? ` · fechada ${fmtDateTime(s.closed_at)}` : ""}
                          {` · fundo ${fmtMoney(s.opening_float_cents, currency)}`}
                        </span>
                      </span>
                      {s.status === "closed" && s.difference_cents != null && (
                        <span className="text-right">
                          <span className="block text-[10px] uppercase tracking-wide text-graphite-400">Diferença</span>
                          <span className={clsx("block font-mono text-sm font-bold tabular-nums", diffTone)}>
                            {s.difference_cents > 0 ? "+" : ""}{fmtMoney(s.difference_cents, currency)}
                          </span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {total > PAGE_SIZE && (
              <div className="mt-3">
                <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
              </div>
            )}
          </>
        )}
      </div>

      {/* open session */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Abrir sessão de caixa">
        <div className="space-y-4">
          {branchTerminals.length === 0 ? (
            <p className="text-xs text-warning">
              Esta filial não tem terminais. Crie um terminal em Definições → Estrutura.
            </p>
          ) : (
            <Field label="Terminal" required>
              <Select value={openTerminal} onChange={(e) => setOpenTerminal(e.target.value)}>
                {branchTerminals.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={`Fundo inicial (${currency})`} required hint="Numerário colocado na gaveta ao abrir.">
            <Input type="number" min={0} step="0.01" value={openFloat} onChange={(e) => setOpenFloat(e.target.value)} />
          </Field>
          <Field label="Etiqueta do turno (opcional)">
            <Input value={openShift} onChange={(e) => setOpenShift(e.target.value)} placeholder="Ex.: manhã, tarde…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Button>
            <Button variant="accent" loading={openBusy} disabled={!openTerminal} onClick={submitOpen}>
              Abrir caixa
            </Button>
          </div>
        </div>
      </Modal>

      {/* session detail */}
      <Modal open={detailOpen && detail !== null} onClose={() => setDetailOpen(false)} title={`Caixa — ${detail?.session.terminal_name ?? ""}`} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-graphite-400">
              <Badge tone={detail.session.status === "open" ? "success" : "neutral"}>
                {detail.session.status === "open" ? "aberta" : "fechada"}
              </Badge>
              <span>{detail.session.branch_name}</span>
              <span>· aberta {fmtDateTime(detail.session.opened_at)} por {detail.session.opened_by_name ?? "—"}</span>
              {detail.session.closed_at && <span>· fechada {fmtDateTime(detail.session.closed_at)}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="text-[10px] uppercase tracking-wide text-graphite-400">Vendas</p>
                <p className="font-mono text-sm font-bold tabular-nums">{fmtMoney(detail.counters.grossCents, currency)}</p>
                <p className="text-[10px] text-graphite-400">{detail.counters.salesCount} transações</p>
              </div>
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="text-[10px] uppercase tracking-wide text-graphite-400">Devoluções</p>
                <p className="font-mono text-sm font-bold tabular-nums text-danger">{fmtMoney(detail.counters.returnsCents, currency)}</p>
              </div>
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="text-[10px] uppercase tracking-wide text-graphite-400">Numerário esperado</p>
                <p className="font-mono text-sm font-bold tabular-nums text-lime-dim dark:text-lime-brand">
                  {fmtMoney(detail.counters.expectedCashCents, currency)}
                </p>
                <p className="text-[10px] text-graphite-400">
                  fundo {fmtMoney(detail.session.opening_float_cents, currency)}
                </p>
              </div>
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="text-[10px] uppercase tracking-wide text-graphite-400">Movimentos</p>
                <p className="font-mono text-xs tabular-nums text-success">+{fmtMoney(detail.counters.movementsInCents, currency)}</p>
                <p className="font-mono text-xs tabular-nums text-danger">−{fmtMoney(detail.counters.movementsOutCents, currency)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Por método de pagamento</p>
                <ul className="space-y-1 text-xs">
                  {Object.entries(detail.counters.byMethod).map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="font-mono">{k}</span>
                      <span className="font-mono tabular-nums">{fmtMoney(v, currency)}</span>
                    </li>
                  ))}
                  {Object.keys(detail.counters.byMethod).length === 0 && (
                    <li className="text-graphite-400">Sem pagamentos na sessão.</li>
                  )}
                </ul>
              </div>
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Entradas / saídas</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {detail.movements.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className={clsx("mr-1.5", m.kind === "in" ? "text-success" : "text-danger")}>
                          {m.kind === "in" ? <ArrowDownToLine className="inline h-3 w-3" /> : <ArrowUpFromLine className="inline h-3 w-3" />}
                        </span>
                        <span className="truncate">{m.reason_code}{m.note ? ` — ${m.note}` : ""}</span>
                        <span className="block pl-5 text-[10px] text-graphite-400">
                          {fmtTime(m.created_at)}{m.user_name ? ` · ${m.user_name}` : ""}
                        </span>
                      </span>
                      <span className={clsx("shrink-0 font-mono tabular-nums", m.kind === "in" ? "text-success" : "text-danger")}>
                        {m.kind === "in" ? "+" : "−"}{fmtMoney(m.amount_cents, currency)}
                      </span>
                    </li>
                  ))}
                  {detail.movements.length === 0 && <li className="text-graphite-400">Sem movimentos manuais.</li>}
                </ul>
              </div>
            </div>

            {detail.session.status === "closed" && detail.session.difference_cents != null && (
              <div className={clsx(
                "rounded-lg p-3 text-xs",
                detail.session.difference_cents === 0
                  ? "bg-green-500/10 text-success"
                  : "bg-red-500/10 text-danger",
              )}>
                Fecho: esperado {fmtMoney(detail.session.expected_cash_cents ?? 0, currency)} · contado{" "}
                {fmtMoney(detail.session.counted_cash_cents ?? 0, currency)} · diferença{" "}
                <strong>{detail.session.difference_cents > 0 ? "+" : ""}{fmtMoney(detail.session.difference_cents, currency)}</strong>
                {detail.session.closing_note ? ` · nota: ${detail.session.closing_note}` : ""}
              </div>
            )}

            {detail.session.status === "open" && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-mist-200 pt-3 dark:border-graphite-700">
                {workspace.can("cash.movement") && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => { setMovOpen({ kind: "in" }); setMovAmount(""); setMovReason("suprimento"); setMovNote(""); }} icon={<ArrowDownToLine className="h-3.5 w-3.5" />}>
                      Entrada
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => { setMovOpen({ kind: "out" }); setMovAmount(""); setMovReason("levantamento"); setMovNote(""); }} icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}>
                      Saída
                    </Button>
                  </>
                )}
                {workspace.can("cash.close") && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setCloseCounted((detail.counters.expectedCashCents / 100).toFixed(2));
                      setCloseNote("");
                      setCloseOpen(true);
                    }}
                    icon={<Lock className="h-3.5 w-3.5" />}
                  >
                    Fechar caixa
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* movement */}
      <Modal open={movOpen !== null} onClose={() => setMovOpen(null)} title={movOpen?.kind === "in" ? "Entrada de numerário" : "Saída de numerário"}>
        <div className="space-y-4">
          <Field label={`Valor (${currency})`} required>
            <Input type="number" min={0.01} step="0.01" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Motivo" required>
            <Select value={movReason} onChange={(e) => setMovReason(e.target.value)}>
              {movOpen?.kind === "in" ? (
                <>
                  <option value="suprimento">Suprimento (reforço de caixa)</option>
                  <option value="payment_received">Cobrança recebida</option>
                  <option value="other_in">Outra entrada</option>
                </>
              ) : (
                <>
                  <option value="levantamento">Levantamento para depósito</option>
                  <option value="petty_expense">Despesa menor</option>
                  <option value="refund_paid">Reembolso pago em numerário</option>
                  <option value="other_out">Outra saída</option>
                </>
              )}
            </Select>
          </Field>
          <Field label="Nota">
            <Input value={movNote} onChange={(e) => setMovNote(e.target.value)} placeholder="Ex.: depósito bancário 15h…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMovOpen(null)}>Cancelar</Button>
            <Button variant="accent" disabled={!movAmount} onClick={submitMovement}>
              Registar
            </Button>
          </div>
        </div>
      </Modal>

      {/* close */}
      <Modal open={closeOpen && detail !== null} onClose={() => setCloseOpen(false)} title="Fechar caixa">
        {detail && (
          <div className="space-y-4">
            <div className="rounded-lg bg-mist-100 p-3 text-xs dark:bg-graphite-800">
              <p className="flex justify-between">
                <span className="text-graphite-400">Numerário esperado (calculado)</span>
                <span className="font-mono font-bold tabular-nums">{fmtMoney(detail.counters.expectedCashCents, currency)}</span>
              </p>
              <p className="mt-1 text-[10px] leading-snug text-graphite-400">
                fundo {fmtMoney(detail.session.opening_float_cents, currency)} + vendas numerário {fmtMoney(detail.counters.cashSalesCents, currency)} − reembolsos numerário {fmtMoney(detail.counters.cashReturnsCents, currency)} + entradas {fmtMoney(detail.counters.movementsInCents, currency)} − saídas {fmtMoney(detail.counters.movementsOutCents, currency)}
              </p>
            </div>
            <Field label={`Numerário contado (${currency})`} required hint="Conte a gaveta antes de fechar. A diferença fica registada.">
              <Input type="number" min={0} step="0.01" value={closeCounted} onChange={(e) => setCloseCounted(e.target.value)} autoFocus />
            </Field>
            {closeCounted && (
              <p className={clsx(
                "text-xs font-medium",
                Math.round(parseFloat(closeCounted.replace(",", ".")) * 100) === detail.counters.expectedCashCents ? "text-success" : "text-warning",
              )}>
                Diferença:{" "}
                {fmtMoney(
                  Math.round(parseFloat(closeCounted.replace(",", ".")) * 100) - detail.counters.expectedCashCents,
                  currency,
                )}
              </p>
            )}
            <Field label="Nota de fecho">
              <Textarea rows={2} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Ex.: depósito efetuado no fim do turno…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCloseOpen(false)}>Cancelar</Button>
              <Button variant="danger" loading={closeBusy} disabled={!closeCounted} onClick={submitClose} icon={<Lock className="h-4 w-4" />}>
                Fechar caixa
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
