"use client";

/**
 * Settings — Aprovações: pending approvals raised by the rules engine
 * (e.g. purchase orders above a threshold). Decisions require
 * purchasing.approve on the server and are audited.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney } from "@/lib/format";

interface ApprovalRow {
  id: string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  params: string;
  status: string;
  reason: string | null;
  created_at: number;
  decided_at: number | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
}

const STATUS_TONES: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function ApprovalsTab() {
  const toast = useToast();
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [status, setStatus] = useState("pending");
  const [deciding, setDeciding] = useState<ApprovalRow | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<ApprovalRow[]>("/api/approvals", { query: { status: status || undefined } }));
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao carregar aprovações.");
    }
  }, [status, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function submitDecision() {
    if (!deciding) return;
    setBusy(true);
    try {
      const fresh = await api<ApprovalRow[]>("/api/approvals", {
        body: { approvalId: deciding.id, decision, reason: reason || undefined },
      });
      setRows(fresh);
      setDeciding(null);
      setReason("");
      toast.success(decision === "approved" ? "Aprovação registada." : "Rejeição registada.");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Sem permissão para decidir (purchasing.approve).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Aprovações"
          icon={<ShieldAlert className="h-4 w-4" />}
          subtitle="Pedidos gerados por regras de negócio. A decisão exige purchasing.approve no servidor e fica na auditoria."
          action={
            <select className="input-base h-8 w-40 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Rejeitadas</option>
              <option value="">Todas</option>
            </select>
          }
        />
        <div className="p-4">
          {!rows ? (
            <div className="flex justify-center py-10 text-graphite-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !rows.length ? (
            <EmptyState
              icon={<ShieldAlert className="h-8 w-8" />}
              title="Sem pedidos"
              message={status === "pending" ? "Nenhuma aprovação pendente." : "Sem registos neste estado."}
            />
          ) : (
            <ul className="divide-y divide-mist-200 dark:divide-graphite-700">
              {rows.map((a) => {
                let params: Record<string, unknown> = {};
                try {
                  params = JSON.parse(a.params) as Record<string, unknown>;
                } catch {
                  /* params kept raw */
                }
                const totalCents = typeof params.total_cents === "number" ? params.total_cents : undefined;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <Badge tone="info">{a.kind}</Badge>
                        {totalCents !== undefined && <span>{fmtMoney(totalCents)}</span>}
                        {params.supplier_name ? <span className="text-graphite-400">· {String(params.supplier_name)}</span> : null}
                        {params.rule_name ? <span className="text-graphite-400">· regra: {String(params.rule_name)}</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-graphite-400">
                        {fmtDateTime(a.created_at)} · pedido por {a.requested_by_name ?? "sistema"}
                        {a.decided_at ? ` · decidido ${fmtDateTime(a.decided_at)} por ${a.decided_by_name ?? "?"}` : ""}
                        {a.reason ? ` · motivo: ${a.reason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONES[a.status] ?? "neutral"}>{a.status}</Badge>
                      {a.status === "pending" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setDeciding(a);
                            setDecision("approved");
                            setReason("");
                          }}
                        >
                          Decidir
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Modal open={Boolean(deciding)} onClose={() => setDeciding(null)} title="Decidir aprovação">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={decision === "approved" ? "accent" : "secondary"} onClick={() => setDecision("approved")}>
              <Check className="h-4 w-4" /> Aprovar
            </Button>
            <Button variant={decision === "rejected" ? "danger" : "secondary"} onClick={() => setDecision("rejected")}>
              <X className="h-4 w-4" /> Rejeitar
            </Button>
          </div>
          <Field label="Motivo (opcional — fica na auditoria)">
            <textarea className="input-base" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeciding(null)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submitDecision} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
