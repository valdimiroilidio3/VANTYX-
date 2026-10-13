# VANTYX® — Universal Business Operating System

Plataforma comercial modular multi-tenant: POS + inventário + CRM + compras +
caixa + analytics + automação, com módulos setoriais que adaptam navegação,
dashboards, modelo de dados e permissões ao perfil de cada negócio.

> ⚠️ **Estado fiscal:** o VANTYX **não é software certificado pela AT**.
> Ver [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) antes de qualquer uso fiscal em produção.

## Stack

- **Next.js 15** (App Router) + **TypeScript strict** (`noUncheckedIndexedAccess`)
- **Tailwind CSS v4** (tema claro/escuro, tokens próprios)
- **better-sqlite3** (SQLite em WAL) com migrações versionadas em SQL-in-TS
- **Vitest** (testes de domínio + integração sobre BD real em memória)
- Dinheiro em **cêntimos inteiros**, quantidades em **mili-unidades inteiras**,
  taxas em **basis points**, tempo em **unix ms**, `org_id` em todas as tabelas

## Como correr

```bash
npm install
npm run db:migrate      # cria/atualiza o esquema (auto-aplicado também no arranque)
npm run seed:demo       # opcional: 2 organizações demo (supermercado + restaurante)
npm run dev             # http://localhost:3000 (liga 0.0.0.0)
```

Produção: `npm run build && npm start`.

### Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `VANTYX_DB_PATH` | `data/vantyx.db` | Caminho do SQLite (`:memory:` para testes) |
| `OPENAI_API_KEY` *(opcional)* | — | Assistente IA; sem chave o estado é `not_configured` (nunca simulado) |

Não há segredos expostos ao browser (`NEXT_PUBLIC_*` não é usado para credenciais).

### Logins demo (após `seed:demo`, password `Demo!23456`)

| Utilizador | Email | Papel |
|---|---|---|
| Supermercado (owner) | `demo.super@vantyx.demo` | owner — Mercado Lumena |
| Caixa | `demo.caixa@vantyx.demo` | cashier (PIN supervisor `2468`) |
| Restaurante (owner) | `demo.rest@vantyx.demo` | owner — Tasca Digital |
| Cozinha | `demo.chef@vantyx.demo` | kitchen |
| Sala | `demo.sala@vantyx.demo` | floor |

Dados demo vivem em organizações marcadas `demo=1`, isoladas de dados reais.
Re-executar o seed é idempotente (deteta pelo nome e ignora).

## Scripts

| Script | Ação |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest (domínio + integração, BD em memória) |
| `npm run db:migrate` | Aplica migrações pendentes |
| `npm run seed:demo` | Carrega dados demo (idempotente) |

## Arquitetura

```
lib/
  db/            client (WAL, tx IMMEDIATE) + migrações 001 core, 002 comércio, 003 setorial
  domain/        money, ean13, barcode (etiquetas de balança), fiscal (hash chain),
                 pricing (IVA incl./excl.), rules-engine (declarativo, sem eval),
                 permissions (ROLE_TEMPLATES + verificação server-side)
  modules/       registry (28 módulos core/industria/opcionais) + industries (12 perfis)
  services/      17 serviços transacionais (org, user, catalog, inventory, sales/checkout,
                 cash, purchasing, customers, restaurant, workshop, scheduling, rule, …)
  dashboards/    registo de widgets com contratos tipados (só dados reais)
  integrations/  registry com estados honestos (not_configured / configured)
  ai/            insights determinísticos + assistente (fallback sem credenciais)
  api/           envelope JSON uniforme, wrapper de rotas, rate limiting
app/api/         ~62 rotas REST (todas com requirePermission server-side)
app/             páginas: login, onboarding (10 passos), dashboard adaptativo, POS,
                 restaurante (sala/cozinha/reservas), produtos+etiquetas, inventário+contagens,
                 vendas, caixa, clientes, fornecedores, compras, relatórios, notificações,
                 definições (regras/integrações/fiscal), oficinas, agenda
tests/           domain.test.ts (37) + integration.test.ts (24)
docs/            COMPLIANCE.md
```

### Garantias críticas

- **Checkout idempotente:** `idempotency_key` e `client_ref` (offline) impedem dupla
  dedução de stock/duplicação de venda em retries — testado.
- **Transações:** operações críticas em `BEGIN IMMEDIATE`; rejeições por regras
  persistem o rasto (aprovação pendente/auditoria) fora da transação abortada.
- **Regras de negócio server-side:** motor declarativo (sem `eval`/código dinâmico);
  ex.: desconto > 10% → HTTP 428 `approval_required`; override por PIN de supervisor.
- **Cadeia de hash fiscal:** cada documento referencia o hash do anterior (SHA-256).
- **Multi-tenant:** todas as queries filtram `org_id`; permissões duplamente
  verificadas (UI + servidor).
- **Setores priorizados:** Supermercados (checkout rápido, EAN-13 + etiquetas de
  balança 20/21/22, stock, reposição) e Restaurantes (mesas, pedidos, tickets de
  cozinha, modificadores, reservas, sessões de turno).
