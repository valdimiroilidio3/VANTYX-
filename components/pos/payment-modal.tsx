"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Banknote, CreditCard, Landmark, Plus, Smartphone, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Field, Input, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { fmtMoney } from "@/lib/format";
import { changeFor } from "@/lib/pos/cart";

export interface PaymentMethodOption {
  id: string;
  key: string;
  name: string;
  kind: string;
  enabled: number;
  is_cash: number;
  requires_terminal: number;
}

export interface PaymentDraft {
  methodKey: string;
  amountCents: number;
  tenderedCents?: number;
}

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  card: CreditCard,
  digital_wallet: Smartphone,
  transfer: Landmark,
  store_credit: Wallet,
  gift_card: Wallet,
  customer_credit: Wallet,
  other: Wallet,
};

/**
 * Split-payment composer. Cash lines capture tendered amount and show
 * change; non-cash lines are recorded as operator-confirmed (real TPA
 * integration is a pending configuration — see Integrações).
 */
export function PaymentModal({
  open,
  onClose,
  totalCents,
  methods,
  currency,
  offline,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  totalCents: number;
  methods: PaymentMethodOption[];
  currency: string;
  offline: boolean;
  onSubmit: (payments: PaymentDraft[]) => void;
  busy: boolean;
}) {
  const toast = useToast();
  const enabled = useMemo(() => methods.filter((m) => m.enabled === 1), [methods]);
  const [drafts, setDrafts] = useState<PaymentDraft[]>([]);
  const [addKey, setAddKey] = useState("");

  useEffect(() => {
    if (open) {
      const cash = enabled.find((m) => m.is_cash === 1);
      setDrafts(cash ? [{ methodKey: cash.key, amountCents: totalCents, tenderedCents: totalCents }] : []);
      setAddKey("");
    }
  }, [open, totalCents, enabled]);

  const paid = drafts.reduce((a, d) => a + d.amountCents, 0);
  const remaining = totalCents - paid;
  const methodByKey = new Map(enabled.map((m) => [m.key, m]));
  const hasCash = drafts.some((d) => methodByKey.get(d.methodKey)?.is_cash === 1);
  const change = hasCash
    ? Math.max(0, drafts.reduce((a, d) => a + (d.tenderedCents ?? d.amountCents), 0) - totalCents)
    : 0;

  function addMethod(key: string) {
    if (!key || drafts.some((d) => d.methodKey === key)) return;
    const amount = Math.max(0, remaining);
    setDrafts((list) => [...list, { methodKey: key, amountCents: amount, tenderedCents: amount }]);
    setAddKey("");
  }

  function update(index: number, patch: Partial<PaymentDraft>) {
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function submit() {
    if (remaining !== 0 && !(remaining < 0 && hasCash)) {
      toast.warning("Valor incompleto", `Faltam ${fmtMoney(Math.max(0, remaining), currency)} para concluir o pagamento.`);
      return;
    }
    const normalized: PaymentDraft[] = drafts.map((d) => {
      const m = methodByKey.get(d.methodKey);
      const tendered = m?.is_cash === 1 ? Math.max(d.tenderedCents ?? d.amountCents, d.amountCents) : undefined;
      // Last line absorbs rounding: cash change handles overpayment
      return { methodKey: d.methodKey, amountCents: d.amountCents, tenderedCents: tendered };
    });
    if (remaining < 0 && hasCash) {
      // Overpayment allowed only via cash change
      const cashIdx = normalized.findIndex((d) => methodByKey.get(d.methodKey)?.is_cash === 1);
      if (cashIdx >= 0) {
        normalized[cashIdx]!.amountCents += remaining; // remaining negative
        normalized[cashIdx]!.tenderedCents = normalized[cashIdx]!.amountCents + change;
      }
    }
    if (normalized.some((d) => d.amountCents <= 0)) {
      toast.error("Pagamento inválido", "Cada método deve ter valor positivo.");
      return;
    }
    onSubmit(normalized);
  }

  return (
    <Modal open={open} onClose={onClose} title="Pagamento" wide>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-lg bg-mist-100 px-4 py-3 dark:bg-graphite-800">
          <span className="text-xs font-medium text-graphite-500 dark:text-graphite-300">Total a pagar</span>
          <span className="font-mono text-2xl font-bold tabular-nums">{fmtMoney(totalCents, currency)}</span>
        </div>

        {offline && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-warning">
            Modo offline: a venda será colocada em fila de sincronização. Pagamentos, faturação e saldos
            <strong> não são confirmados localmente</strong> — o documento só é emitido quando o servidor validar a operação.
          </p>
        )}

        <ul className="space-y-2">
          {drafts.map((d, i) => {
            const m = methodByKey.get(d.methodKey);
            const Icon = KIND_ICONS[m?.kind ?? "other"] ?? Wallet;
            const isCash = m?.is_cash === 1;
            return (
              <li key={d.methodKey} className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-graphite-400" />
                  <span className="text-xs font-semibold">{m?.name ?? d.methodKey}</span>
                  {isCash && <Badge tone="success">numerário</Badge>}
                  {m?.requires_terminal === 1 && <Badge tone="warning">TPA — registo manual</Badge>}
                  <button
                    className="ml-auto rounded p-1 text-graphite-400 hover:text-danger"
                    onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                    aria-label={`Remover ${m?.name ?? d.methodKey}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label={isCash ? "Valor pago" : "Valor"}>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={(d.amountCents / 100).toFixed(2)}
                      onChange={(e) => {
                        const cents = Math.round(parseFloat(e.target.value || "0") * 100);
                        update(i, { amountCents: Math.max(0, cents), tenderedCents: Math.max(0, cents) });
                      }}
                    />
                  </Field>
                  {isCash ? (
                    <Field label="Entregue pelo cliente">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={((d.tenderedCents ?? d.amountCents) / 100).toFixed(2)}
                        onChange={(e) => {
                          const cents = Math.round(parseFloat(e.target.value || "0") * 100);
                          update(i, { tenderedCents: Math.max(d.amountCents, cents) });
                        }}
                      />
                    </Field>
                  ) : (
                    <div className="flex items-end">
                      <div className="flex w-full flex-wrap gap-1 pb-1">
                        {[5, 10, 20, 50].map((v) => (
                          <button
                            key={v}
                            className="rounded border border-mist-200 px-2 py-0.5 text-[11px] text-graphite-500 hover:border-lime-brand dark:border-graphite-600"
                            onClick={() => update(i, { amountCents: v * 100, tenderedCents: v * 100 })}
                          >
                            {v}€
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {drafts.length < enabled.length && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Adicionar método (pagamento dividido)">
                <Select value={addKey} onChange={(e) => setAddKey(e.target.value)}>
                  <option value="">Selecionar…</option>
                  {enabled
                    .filter((m) => !drafts.some((d) => d.methodKey === m.key))
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Button variant="secondary" onClick={() => addMethod(addKey)} disabled={!addKey} icon={<Plus className="h-4 w-4" />}>
              Adicionar
            </Button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-lg border border-mist-200 p-3 text-center dark:border-graphite-600">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-graphite-400">Pago</p>
            <p className={clsx("font-mono text-sm font-bold tabular-nums", paid >= totalCents ? "text-success" : "")}>
              {fmtMoney(Math.min(paid, totalCents), currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-graphite-400">Em falta</p>
            <p className={clsx("font-mono text-sm font-bold tabular-nums", remaining > 0 && "text-danger")}>
              {fmtMoney(Math.max(0, remaining), currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-graphite-400">Troco</p>
            <p className="font-mono text-sm font-bold tabular-nums text-lime-dim dark:text-lime-brand">
              {fmtMoney(changeFor(totalCents, paid) > 0 && hasCash ? change : 0, currency)}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" loading={busy} disabled={drafts.length === 0} onClick={submit}>
            {offline ? "Colocar em fila" : "Finalizar venda"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
