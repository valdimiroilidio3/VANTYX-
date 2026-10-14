"use client";

/**
 * VANTYX intelligent onboarding — 10 steps:
 *  1 criar organização · 2 setor · 3 subtipo · 4 localização/moeda ·
 *  5 conta proprietário (cria + autentica) · 6 impostos/documentos ·
 *  7 catálogo inicial · 8 utilizadores · 9 pagamentos/terminais ·
 *  10 validação e entrada.
 * Steps 6-10 run authenticated and adapt to the chosen industry.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  Landmark,
  Rocket,
  Store,
  Users as UsersIcon,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Badge, Button, Field, Input, Select, Textarea, Toggle } from "@/components/ui";
import { iconFor } from "@/components/layout/icons";

const INDUSTRIES = [
  { key: "supermarket", label: "Supermercado / Minimercado", icon: "shopping-cart", desc: "Checkout rápido, balanças, validades, reposição." },
  { key: "restaurant", label: "Restaurante / Café / Takeaway", icon: "utensils-crossed", desc: "Mesas, comandas, cozinha, modificadores, turnos." },
  { key: "fashion", label: "Roupa, Calçado & Acessórios", icon: "shirt", desc: "Tamanhos/cores, coleções, trocas." },
  { key: "auto_parts", label: "Peças Automóveis & Oficina", icon: "car", desc: "Referências OEM, compatibilidade, ordens de reparação." },
  { key: "salon", label: "Barbearia, Salão & Spa", icon: "scissors", desc: "Agenda, marcações, comissões." },
  { key: "electronics", label: "Eletrónica & Informática", icon: "cpu", desc: "Séries, IMEI, garantias, RMA." },
  { key: "wholesale", label: "Armazém / Distribuidor / Grossista", icon: "container", desc: "Preços por cliente, crédito comercial, picking." },
  { key: "construction", label: "Materiais de Construção", icon: "hard-hat", desc: "Venda por medida, entregas a obra." },
  { key: "pharmacy", label: "Farmácia (âmbito limitado)", icon: "pill", desc: "Sem dispensa/receitas — apenas retalho permitido." },
  { key: "bookstore", label: "Livraria & Papelaria", icon: "book-open", desc: "ISBN, editoras, listas escolares." },
  { key: "furniture", label: "Móveis & Decoração", icon: "armchair", desc: "Configuráveis, encomendas, entregas." },
  { key: "pet", label: "Pet Shop", icon: "paw-print", desc: "Espécies, lotes/validades, packs." },
  { key: "services", label: "Serviços & Multi-Filial", icon: "briefcase", desc: "Serviços e estruturas multi-local." },
] as const;

/** Fotografia real por setor (tiles do onboarding). Setores sem foto usam gradiente. */
const INDUSTRY_PHOTOS: Record<string, string> = {
  supermarket: "/images/industries/supermarket.jpg",
  restaurant: "/images/industries/restaurant.jpg",
  fashion: "/images/industries/fashion.jpg",
  auto_parts: "/images/industries/auto_parts.jpg",
  salon: "/images/industries/salon.jpg",
  electronics: "/images/industries/electronics.jpg",
  wholesale: "/images/industries/wholesale.jpg",
  construction: "/images/industries/construction.jpg",
};

const INDUSTRY_GRADIENTS: Record<string, string> = {
  pharmacy: "linear-gradient(135deg,#34d399 0%,#0ea5e9 100%)",
  bookstore: "linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)",
  furniture: "linear-gradient(135deg,#a78bfa 0%,#6366f1 100%)",
  pet: "linear-gradient(135deg,#f472b6 0%,#fb923c 100%)",
  services: "linear-gradient(135deg,#38bdf8 0%,#818cf8 100%)",
};

const SUBTYPES: Record<string, { key: string; label: string }[]> = {
  supermarket: [
    { key: "supermarket", label: "Supermercado" },
    { key: "minimarket", label: "Minimercado" },
    { key: "convenience", label: "Loja de conveniência" },
    { key: "greengrocer", label: "Frutaria / Mercearia" },
  ],
  restaurant: [
    { key: "restaurant", label: "Restaurante" },
    { key: "cafe", label: "Café / Pastelaria" },
    { key: "bar", label: "Bar" },
    { key: "takeaway", label: "Takeaway" },
    { key: "fastfood", label: "Fast-food" },
  ],
  fashion: [
    { key: "clothing", label: "Loja de roupa" },
    { key: "shoes", label: "Sapataria" },
    { key: "accessories", label: "Acessórios" },
  ],
  auto_parts: [
    { key: "parts_retail", label: "Loja de peças" },
    { key: "workshop", label: "Oficina" },
    { key: "parts_and_workshop", label: "Peças + Oficina" },
  ],
  salon: [
    { key: "barbershop", label: "Barbearia" },
    { key: "hair_salon", label: "Cabeleireiro" },
    { key: "beauty_spa", label: "Estética / Spa" },
  ],
  electronics: [
    { key: "electronics", label: "Eletrónica" },
    { key: "computer_store", label: "Informática" },
    { key: "mobile", label: "Telemóveis" },
  ],
  wholesale: [
    { key: "distributor", label: "Distribuidor" },
    { key: "cash_carry", label: "Cash & Carry" },
  ],
  construction: [
    { key: "building_materials", label: "Materiais de construção" },
    { key: "hardware", label: "Ferragens" },
  ],
  pharmacy: [
    { key: "pharmacy_retail", label: "Farmácia (retalho não medicamentoso)" },
    { key: "parapharmacy", label: "Parafarmácia" },
  ],
  bookstore: [
    { key: "bookstore", label: "Livraria" },
    { key: "stationery", label: "Papelaria" },
  ],
  furniture: [
    { key: "furniture", label: "Mobiliário" },
    { key: "decor", label: "Decoração" },
  ],
  pet: [
    { key: "pet_shop", label: "Pet shop" },
    { key: "pet_food", label: "Alimentação animal" },
  ],
  services: [
    { key: "services", label: "Serviços" },
    { key: "multi_branch_retail", label: "Retalho multi-filial" },
  ],
};

const STEPS = [
  "Organização",
  "Setor",
  "Subtipo",
  "Localização",
  "Conta",
  "Impostos",
  "Catálogo",
  "Equipa",
  "Pagamentos",
  "Entrar",
];

interface Bootstrap {
  org: { id: string; name: string; currency: string; industry: string; settings: Record<string, unknown>; onboarded: boolean; pricesIncludeTax: boolean; defaultTaxBps: number };
  terminals: { id: string; name: string; code: string }[];
  branches: { id: string; name: string }[];
}

function OnboardingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const continueMode = searchParams.get("continue") === "1";

  const [step, setStep] = useState(continueMode ? 5 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Steps 1-5 state
  const [orgName, setOrgName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [industry, setIndustry] = useState<string>("supermarket");
  const [subIndustry, setSubIndustry] = useState<string>("");
  const [country, setCountry] = useState("PT");
  const [currency, setCurrency] = useState("EUR");
  const [timezone, setTimezone] = useState("Europe/Lisbon");
  const [branchName, setBranchName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  // Steps 6-10 state (authenticated)
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [defaultTaxBps, setDefaultTaxBps] = useState(2300);
  const [seriesPrefix, setSeriesPrefix] = useState("VD");
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; key: string; name: string; enabled: number }[]>([]);
  const [embeddedPrefixes, setEmbeddedPrefixes] = useState("20,21,22");
  const [embeddedMode, setEmbeddedMode] = useState<"price" | "weight">("price");
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("cashier");
  const [userCreated, setUserCreated] = useState<string | null>(null);

  useEffect(() => {
    if (!continueMode) return;
    api<Bootstrap & { authenticated: boolean }>("/api/auth/me")
      .then(async (me) => {
        if (!me.authenticated) {
          setStep(0);
          return;
        }
        setBootstrap(me as unknown as Bootstrap);
        setPricesIncludeTax(me.org.pricesIncludeTax);
        setDefaultTaxBps(me.org.defaultTaxBps);
        const settings = me.org.settings;
        if (Array.isArray(settings.barcodeEmbeddedPrefixes)) {
          setEmbeddedPrefixes((settings.barcodeEmbeddedPrefixes as string[]).join(","));
        }
        if (settings.barcodeEmbeddedMode === "weight") setEmbeddedMode("weight");
        const methods = await api<{ id: string; key: string; name: string; enabled: number }[]>("/api/cash/methods");
        setPaymentMethods(methods);
      })
      .catch(() => setStep(0));
  }, [continueMode, router]);

  const subtypes = useMemo(() => SUBTYPES[industry] ?? [], [industry]);

  function next() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function createOrg() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/onboarding", {
        method: "POST",
        body: {
          orgName,
          legalName: legalName || undefined,
          taxId: taxId || undefined,
          industry,
          subIndustry: subIndustry || undefined,
          country,
          currency,
          timezone,
          branchName: branchName || undefined,
          ownerName,
          ownerEmail,
          ownerPassword,
        },
      });
      // Reload session-scoped bootstrap
      const me = await api<Bootstrap & { authenticated: boolean }>("/api/auth/me");
      setBootstrap(me as unknown as Bootstrap);
      const methods = await api<{ id: string; key: string; name: string; enabled: number }[]>("/api/cash/methods");
      setPaymentMethods(methods);
      next();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.body.message : "Falha ao criar organização.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFiscal() {
    setBusy(true);
    try {
      await api("/api/profile", {
        method: "PATCH",
        body: { pricesIncludeTax, defaultTaxBps },
      });
      await api("/api/settings/fiscal", {
        method: "POST",
        body: { docType: "FT", prefix: seriesPrefix, fiscalYear: new Date().getFullYear() },
      }).catch(() => null);
      next();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.body.message : "Falha ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ created: number; updated: number; errors: number }>("/api/products/csv", {
        method: "POST",
        body: { csv: csvText },
      });
      setImportResult(
        `Importação concluída: ${result.created} criados, ${result.updated} atualizados, ${result.errors} erros.`,
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.body.message : "Falha na importação.");
    } finally {
      setBusy(false);
    }
  }

  async function savePayments() {
    setBusy(true);
    try {
      const prefixes = embeddedPrefixes.split(",").map((p) => p.trim()).filter(Boolean);
      await api("/api/profile", {
        method: "PATCH",
        body: { settings: { barcodeEmbeddedPrefixes: prefixes, barcodeEmbeddedMode: embeddedMode } },
      });
      next();
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await api("/api/onboarding", { method: "PATCH", body: {} });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.body.message : "Falha ao concluir.");
    } finally {
      setBusy(false);
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-graphite-900 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime-brand font-mono text-base font-black text-graphite-900">
            V
          </span>
          <span className="font-mono text-sm font-bold tracking-widest text-mist-100">
            VANTYX<span className="align-super text-[8px]">®</span>
          </span>
          <span className="ml-auto text-xs text-graphite-400">
            Passo {step + 1} de {STEPS.length} · {STEPS[step]}
          </span>
        </div>

        <div className="mb-6 h-1 overflow-hidden rounded-full bg-graphite-700">
          <div
            className="h-full rounded-full bg-lime-brand transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="card p-6">
          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-xs font-medium text-danger">
              {error}
            </p>
          )}

          {/* STEP 1 — Organization */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Store className="h-4 w-4 text-lime-dim" /> Criar organização
              </h2>
              <Field label="Nome comercial" required>
                <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Ex.: Mercearia Central" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome legal">
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Ex.: Central — Lda." />
                </Field>
                <Field label="NIF / Tax ID">
                  <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="500000000" />
                </Field>
              </div>
              <Field label="Nome da filial principal">
                <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Loja Principal" />
              </Field>
              <div className="flex justify-end">
                <Button variant="accent" disabled={!orgName.trim()} onClick={next}>
                  Continuar <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2 — Industry */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Escolher setor de atividade</h2>
              <p className="text-xs text-graphite-400">
                O setor determina módulos, dashboards, modo de checkout e regras iniciais. Poderá ser alterado mais tarde com migração controlada (os dados nunca são transformados automaticamente).
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {INDUSTRIES.map((ind) => {
                  const Icon = iconFor(ind.icon);
                  const photo = INDUSTRY_PHOTOS[ind.key];
                  const selected = industry === ind.key;
                  return (
                    <button
                      key={ind.key}
                      onClick={() => {
                        setIndustry(ind.key);
                        setSubIndustry(SUBTYPES[ind.key]?.[0]?.key ?? "");
                      }}
                      className={clsx(
                        "hover-lift group relative h-40 overflow-hidden rounded-2xl text-left ring-1 ring-black/5 transition-shadow dark:ring-white/10",
                        selected ? "shadow-glow-lime ring-2 ring-lime-brand" : "",
                      )}
                      style={!photo ? { backgroundImage: INDUSTRY_GRADIENTS[ind.key] ?? "linear-gradient(135deg,#334155,#0f172a)" } : undefined}
                      aria-pressed={selected}
                    >
                      {photo && (
                        <>
                          <Image src={photo} alt="" fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
                          <span className="absolute inset-0 bg-gradient-to-t from-graphite-950/90 via-graphite-950/35 to-transparent" aria-hidden />
                        </>
                      )}
                      <span className={clsx(
                        "absolute top-2.5 left-2.5 flex h-8 w-8 items-center justify-center rounded-xl backdrop-blur-md",
                        photo ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-white/20 text-white ring-1 ring-white/30",
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {selected && (
                        <span className="absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-lime-brand text-graphite-950 shadow-glow-lime">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 p-3">
                        <span className={clsx("block text-sm font-bold tracking-tight", photo ? "text-white" : "text-white")}>{ind.label}</span>
                        <span className={clsx("mt-0.5 block text-[11px] leading-snug", photo ? "text-mist-200/85" : "text-white/80")}>{ind.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {industry === "pharmacy" && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-warning">
                  Âmbito legal limitado: dispensa de medicamentos, receitas eletrónicas e substâncias regulamentadas NÃO estão incluídas e exigem validação legal e integrações autorizadas.
                </p>
              )}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" onClick={next}>Continuar <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* STEP 3 — Subtype */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Selecionar subtipo</h2>
              <div className="grid grid-cols-2 gap-2">
                {subtypes.map((st) => (
                  <button
                    key={st.key}
                    onClick={() => setSubIndustry(st.key)}
                    className={clsx(
                      "rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors",
                      subIndustry === st.key
                        ? "border-lime-brand bg-lime-brand/10 text-lime-dim dark:text-lime-brand"
                        : "border-mist-200 hover:border-graphite-400 dark:border-graphite-600",
                    )}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" onClick={next}>Continuar <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* STEP 4 — Location */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Localização, moeda e fuso horário</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="País">
                  <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="PT">Portugal</option>
                    <option value="ES">Espanha</option>
                    <option value="FR">França</option>
                    <option value="BR">Brasil</option>
                    <option value="AO">Angola</option>
                    <option value="MZ">Moçambique</option>
                    <option value="US">Estados Unidos</option>
                  </Select>
                </Field>
                <Field label="Moeda">
                  <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="EUR">EUR — Euro</option>
                    <option value="BRL">BRL — Real</option>
                    <option value="USD">USD — Dólar</option>
                    <option value="AOA">AOA — Kwanza</option>
                    <option value="MZN">MZN — Metical</option>
                  </Select>
                </Field>
                <Field label="Fuso horário">
                  <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    <option value="Europe/Lisbon">Europe/Lisbon</option>
                    <option value="Atlantic/Azores">Atlantic/Azores</option>
                    <option value="Europe/Madrid">Europe/Madrid</option>
                    <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                    <option value="Africa/Luanda">Africa/Luanda</option>
                    <option value="Africa/Maputo">Africa/Maputo</option>
                  </Select>
                </Field>
                <Field label="Idioma (interface)">
                  <Input value="Português (pt-PT)" disabled />
                </Field>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" onClick={next}>Continuar <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* STEP 5 — Owner account (creates + logs in) */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <UsersIcon className="h-4 w-4 text-lime-dim" /> Conta do proprietário
              </h2>
              <Field label="Nome" required>
                <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nome completo" />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="email@empresa.pt" />
              </Field>
              <Field label="Palavra-passe" required hint="Mínimo 8 caracteres, letras e números.">
                <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button
                  variant="accent"
                  loading={busy}
                  disabled={!ownerName.trim() || !ownerEmail.includes("@") || ownerPassword.length < 8}
                  onClick={createOrg}
                >
                  Criar organização <Rocket className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 6 — Taxes & documents */}
          {step === 5 && bootstrap && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Landmark className="h-4 w-4 text-lime-dim" /> Impostos e documentos
              </h2>
              <div className="flex items-center justify-between rounded-lg border border-mist-200 px-3 py-2.5 dark:border-graphite-600">
                <div>
                  <p className="text-xs font-semibold">Preços com imposto incluído</p>
                  <p className="text-[11px] text-graphite-400">Ativo no retalho PT; grossistas usam normalmente preços sem IVA.</p>
                </div>
                <Toggle checked={pricesIncludeTax} onChange={setPricesIncludeTax} label="Preços com imposto" />
              </div>
              <Field label="Taxa de imposto por omissão (IVA %)" hint="23 = taxa normal PT; 6/13 reduzida/intermédia por produto.">
                <Select value={String(defaultTaxBps)} onChange={(e) => setDefaultTaxBps(Number(e.target.value))}>
                  <option value="2300">23% — Normal</option>
                  <option value="1300">13% — Intermédia</option>
                  <option value="600">6% — Reduzida</option>
                  <option value="0">0% — Isento</option>
                </Select>
              </Field>
              <Field label="Prefixo da série documental (FT)" hint="Numeração: FT PREFIXO/nº — controlada e sequencial por ano fiscal.">
                <Input value={seriesPrefix} onChange={(e) => setSeriesPrefix(e.target.value.toUpperCase().slice(0, 8))} />
              </Field>
              <p className="rounded-md bg-blue-500/10 px-3 py-2 text-[11px] text-info">
                Documentos finalizados são imutáveis (correção apenas por nota de crédito) e protegidos por cadeia de hash SHA-256. Certificação AT/ATCUD/QR Code: pendente de validação legal — ver docs/COMPLIANCE.md.
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" loading={busy} onClick={saveFiscal}>Guardar e continuar <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* STEP 7 — Initial catalog */}
          {step === 6 && bootstrap && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-lime-dim" /> Catálogo inicial
              </h2>
              <p className="text-xs text-graphite-400">
                Importe um CSV (colunas: <code className="font-mono text-[10px]">sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,stock,reorder_point</code>) ou ignore e adicione produtos depois. Preços em euros com ponto decimal.
              </p>
              <Textarea
                rows={7}
                className="font-mono text-[11px]"
                placeholder={"sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,stock,reorder_point\nCAFE-001,Café expresso,0.90,0.30,2300,un,units,Bebidas,,500,"}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              {importResult && <p className="text-xs font-medium text-success">{importResult}</p>}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <div className="flex gap-2">
                  {csvText.trim() && (
                    <Button variant="secondary" loading={busy} onClick={runImport}>
                      Importar agora
                    </Button>
                  )}
                  <Button variant="accent" onClick={next}>
                    {importResult ? "Continuar" : "Ignorar por agora"} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 8 — Team */}
          {step === 7 && bootstrap && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <UsersIcon className="h-4 w-4 text-lime-dim" /> Utilizadores e permissões
              </h2>
              <p className="text-xs text-graphite-400">
                Crie já a primeira conta de operador ou convide mais tarde em Definições → Equipa. Funções: gerente, caixa, cozinha, sala, armazém, contabilidade, observador.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome">
                  <Input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Maria Silva" />
                </Field>
                <Field label="Email">
                  <Input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="maria@empresa.pt" />
                </Field>
                <Field label="Palavra-passe provisória">
                  <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
                </Field>
                <Field label="Função">
                  <Select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)}>
                    <option value="manager">Gerente</option>
                    <option value="cashier">Caixa</option>
                    <option value="kitchen">Cozinha</option>
                    <option value="floor">Sala / Mesa</option>
                    <option value="stockroom">Armazém</option>
                    <option value="accountant">Contabilidade</option>
                  </Select>
                </Field>
              </div>
              {userCreated && <p className="text-xs font-medium text-success">{userCreated}</p>}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    loading={busy}
                    disabled={!newUserName || !newUserEmail.includes("@") || newUserPassword.length < 8}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/users", {
                          method: "POST",
                          body: { name: newUserName, email: newUserEmail, password: newUserPassword, roleKey: newUserRole },
                        });
                        setUserCreated(`Utilizador ${newUserEmail} criado com função ${newUserRole}.`);
                        setNewUserName(""); setNewUserEmail(""); setNewUserPassword("");
                      } catch (err) {
                        setError(err instanceof ApiClientError ? err.body.message : "Falha ao criar utilizador.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Criar utilizador
                  </Button>
                  <Button variant="accent" onClick={next}>Continuar <ArrowRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 9 — Payments & terminals */}
          {step === 8 && bootstrap && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">Pagamentos e terminais</h2>
              <div className="space-y-2">
                {paymentMethods.map((pm) => (
                  <div key={pm.id} className="flex items-center justify-between rounded-lg border border-mist-200 px-3 py-2 dark:border-graphite-600">
                    <div>
                      <p className="text-xs font-semibold">{pm.name}</p>
                      <p className="font-mono text-[10px] text-graphite-400">{pm.key}</p>
                    </div>
                    <Toggle
                      checked={pm.enabled === 1}
                      label={pm.name}
                      onChange={async (v) => {
                        setPaymentMethods((list) =>
                          list.map((x) => (x.id === pm.id ? { ...x, enabled: v ? 1 : 0 } : x)),
                        );
                        await api("/api/cash/methods", { method: "POST", body: { methodId: pm.id, enabled: v } }).catch(() => null);
                      }}
                    />
                  </div>
                ))}
              </div>
              {industry === "supermarket" && (
                <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                  <p className="text-xs font-semibold">Códigos de barras de balança (EAN-13 embutido)</p>
                  <p className="mt-0.5 text-[11px] text-graphite-400">
                    Etiquetas impressas por balanças: prefixo + código interno (5) + preço/peso (6) + dígito de controlo.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Field label="Prefixos (separados por vírgula)">
                      <Input value={embeddedPrefixes} onChange={(e) => setEmbeddedPrefixes(e.target.value)} />
                    </Field>
                    <Field label="Payload">
                      <Select value={embeddedMode} onChange={(e) => setEmbeddedMode(e.target.value as "price" | "weight")}>
                        <option value="price">Preço (cêntimos)</option>
                        <option value="weight">Peso (gramas)</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-graphite-400">
                Terminais TPA reais exigem fornecedor certificado (Definições → Integrações). Dados de cartões nunca são armazenados no VANTYX.
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" loading={busy} onClick={savePayments}>Guardar e continuar <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}

          {/* STEP 10 — Validate & enter */}
          {step === 9 && bootstrap && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Check className="h-4 w-4 text-lime-brand" /> Validar configuração
              </h2>
              <ul className="space-y-1.5 text-xs">
                {[
                  { label: `Organização "${bootstrap.org.name}" criada`, ok: true },
                  { label: `Setor: ${INDUSTRIES.find((i) => i.key === bootstrap.org.industry)?.label ?? bootstrap.org.industry} — módulos e dashboards gerados`, ok: true },
                  { label: `Moeda ${bootstrap.org.currency} · preços ${pricesIncludeTax ? "com" : "sem"} imposto · IVA ${(defaultTaxBps / 100).toFixed(0)}%`, ok: true },
                  { label: importResult ? `Catálogo: ${importResult}` : "Catálogo: vazio — adicione produtos quando quiser", ok: true },
                  { label: userCreated ? `Equipa: ${userCreated}` : "Equipa: apenas o proprietário (convide depois)", ok: true },
                  { label: `Pagamentos: ${paymentMethods.filter((p) => p.enabled === 1).length} métodos ativos`, ok: paymentMethods.some((p) => p.enabled === 1) },
                  { label: "Documentos: séries FT/NC ativas com cadeia de hash", ok: true },
                  { label: "Certificação fiscal AT: pendente de validação legal (não bloqueia operação interna)", ok: true, warn: true },
                ].map((row, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={clsx("mt-0.5", row.warn ? "text-warning" : row.ok ? "text-success" : "text-danger")}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className={clsx(row.warn && "text-graphite-400")}>{row.label}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 rounded-md bg-lime-brand/10 px-3 py-2">
                <Badge tone="accent">PRONTO</Badge>
                <p className="text-[11px]">
                  O dashboard, a navegação e o POS foram montados a partir dos módulos do seu setor.
                </p>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="accent" size="lg" loading={busy} onClick={finish}>
                  Entrar no VANTYX <Rocket className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Loading bootstrap for continue mode */}
          {step >= 5 && !bootstrap && (
            <div className="py-10 text-center text-xs text-graphite-400">A carregar sessão…</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-graphite-900" />}>
      <OnboardingWizard />
    </Suspense>
  );
}
