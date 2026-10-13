"use client";

/**
 * Settings — Módulos: registry of the 28 modules with enable/disable.
 * Disable is never destructive: dependents block it and existing data rows
 * require explicit confirmation (data is always preserved).
 */

import { useCallback, useEffect, useState } from "react";
import { Boxes, Check, Loader2, Power, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Modal } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";

interface ModuleRow {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  industries: string[] | null;
  dependencies: string[];
  licenseTier: string;
  enabled: boolean;
  dataRows: number;
}

interface DisablePreview {
  moduleId: string;
  dependents: { id: string; name: string }[];
  dataRows: number;
  blocked: boolean;
  reason?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  core: "Núcleo universal",
  industry: "Setor",
  optional: "Opcional",
  premium: "Premium",
};

export function ModulesTab() {
  const toast = useToast();
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<DisablePreview | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await api<ModuleRow[]>("/api/modules"));
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao carregar módulos.");
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(moduleId: string, action: "enable" | "disable" | "preview_disable") {
    setBusy(moduleId);
    try {
      if (action === "preview_disable") {
        const data = await api<DisablePreview>("/api/modules", { body: { moduleId, action } });
        setPreview(data);
        setPreviewName(rows?.find((m) => m.id === moduleId)?.name ?? moduleId);
        return;
      }
      // The confirmation modal IS the explicit acknowledgement (it shows the
      // data-row count); confirmDataLoss unlocks the server-side guard.
      await api("/api/modules", {
        body: { moduleId, action, confirmDataLoss: action === "disable" },
      });
      toast.success(action === "enable" ? "Módulo ativado." : "Módulo desativado — dados preservados.");
      setPreview(null);
      await load();
      // Navigation depends on enabled modules → reload the workspace context.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro.");
    } finally {
      setBusy(null);
    }
  }

  const visible = (rows ?? []).filter(
    (m) =>
      !filter ||
      m.name.toLowerCase().includes(filter.toLowerCase()) ||
      m.id.includes(filter.toLowerCase()) ||
      m.description.toLowerCase().includes(filter.toLowerCase()),
  );
  const enabledCount = (rows ?? []).filter((m) => m.enabled).length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Módulos"
          subtitle={`${enabledCount} de ${rows?.length ?? 0} ativos. As permissões são sempre validadas no servidor — desativar um módulo remove rotas e menus para todos.`}
          icon={<Boxes className="h-4 w-4" />}
          action={
            <input
              className="input-base h-8 w-44 text-sm"
              placeholder="Procurar módulo…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          }
        />
        <div className="p-4">
          {!rows ? (
            <div className="flex justify-center py-10 text-graphite-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !visible.length ? (
            <EmptyState icon={<Boxes className="h-8 w-8" />} title="Sem resultados" message="Nenhum módulo corresponde à pesquisa." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.enabled
                      ? "rounded-lg border border-mist-200 bg-white p-4 dark:border-graphite-700 dark:bg-graphite-850"
                      : "rounded-lg border border-dashed border-mist-300 bg-mist-100/50 p-4 dark:border-graphite-600 dark:bg-graphite-800/40"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight">{m.name}</p>
                      <p className="text-xs text-graphite-400">
                        {CATEGORY_LABELS[m.category] ?? m.category} · v{m.version}
                        {m.licenseTier !== "standard" && ` · ${m.licenseTier}`}
                      </p>
                    </div>
                    <Badge tone={m.enabled ? "success" : "neutral"}>
                      {m.enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {m.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-graphite-500 dark:text-graphite-300">{m.description}</p>
                  {m.dataRows > 0 && (
                    <p className="mt-1 text-xs font-medium text-info">{m.dataRows.toLocaleString("pt-PT")} registos de dados</p>
                  )}
                  {m.dependencies.length > 0 && (
                    <p className="mt-1 text-xs text-graphite-400">Depende de: {m.dependencies.join(", ")}</p>
                  )}
                  <div className="mt-3 flex justify-end">
                    {m.enabled ? (
                      <Button size="sm" variant="secondary" disabled={busy === m.id} onClick={() => act(m.id, "preview_disable")}>
                        {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        Desativar
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={busy === m.id} onClick={() => act(m.id, "enable")}>
                        {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        Ativar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={`Desativar "${previewName}"`}>
        {preview &&
          (preview.blocked ? (
            <p className="text-sm font-medium text-danger">{preview.reason}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-graphite-500 dark:text-graphite-300">
                {preview.reason ??
                  "O módulo será ocultado da navegação e as suas rotas passarão a devolver 403 (verificação no servidor)."}
              </p>
              {preview.dataRows > 0 && (
                <p className="rounded-md bg-mist-100 p-3 font-medium dark:bg-graphite-800">
                  ⚠ Existem {preview.dataRows.toLocaleString("pt-PT")} registos. Os dados NÃO são apagados — voltam a
                  ficar acessíveis se reativar o módulo.
                </p>
              )}
            </div>
          ))}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPreview(null)}>
            Cancelar
          </Button>
          {preview && !preview.blocked && (
            <Button variant="danger" disabled={busy === preview.moduleId} onClick={() => act(preview.moduleId, "disable")}>
              {busy === preview.moduleId && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar desativação
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
