"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api/client";

export interface SupervisorOption {
  id: string;
  name: string;
  roleKey: string;
  roleName: string;
}

/**
 * Supervisor PIN override — used when a business rule requires approval
 * (e.g. desconto acima do limite do caixa). The PIN is sent once, over
 * the checkout request, and verified server-side; it is never stored or
 * logged in the client.
 */
export function SupervisorModal({
  open,
  onClose,
  reason,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  reason: string;
  onConfirm: (supervisor: { userId: string; pin: string }) => void;
  busy: boolean;
}) {
  const [supervisors, setSupervisors] = useState<SupervisorOption[]>([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setLoadError(null);
    api<SupervisorOption[]>("/api/pos/supervisors")
      .then((rows) => {
        setSupervisors(rows);
        if (rows.length) setUserId((u) => u || rows[0]!.id);
      })
      .catch(() => setLoadError("Não foi possível carregar a lista de supervisores."));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Aprovação de supervisor">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-xs font-semibold text-warning">Operação bloqueada por regra</p>
            <p className="mt-0.5 text-[11px] leading-snug text-graphite-500 dark:text-graphite-300">{reason}</p>
          </div>
        </div>

        {loadError && <p className="text-xs text-danger">{loadError}</p>}
        {supervisors.length === 0 && !loadError && (
          <p className="text-xs text-graphite-400">
            Nenhum utilizador com PIN registado. Peça a um gerente para definir o PIN em Definições → Equipa.
          </p>
        )}

        <Field label="Supervisor" required>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.roleName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PIN" required hint="4 a 8 dígitos. Verificado no servidor; nunca é guardado no terminal.">
          <Input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && userId && /^\d{4,8}$/.test(pin)) onConfirm({ userId, pin });
            }}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="accent"
            loading={busy}
            disabled={!userId || !/^\d{4,8}$/.test(pin)}
            onClick={() => onConfirm({ userId, pin })}
          >
            Aprovar e finalizar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
