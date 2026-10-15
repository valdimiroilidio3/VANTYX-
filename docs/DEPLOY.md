# VANTYX® — Guia de Lançamento (Deployment)

> **Data:** 2026-10-15 · **Modo de produção validado localmente:** `next build` +
> `next start` → login, dashboard, POS, definições fiscais e exportação SAF-T
> todos 200 OK. A app está pronta para qualquer servidor com **disco persistente**
> e processo Node permanente (VPS, Fly.io, Railway, Render, Docker, máquina local).

---

## ⚠️ Vercel — porque NÃO funciona com a arquitetura atual

A Vercel é uma plataforma **serverless**: cada request corre numa função efémera
com sistema de ficheiros **read-only** (apenas `/tmp` gravável, apagado entre
invocações/instâncias). O VANTYX usa **SQLite local** (`better-sqlite3`, WAL,
transações `BEGIN IMMEDIATE`, API síncrona) — pelo que, na Vercel:

1. O ficheiro `data/vantyx.db` **não existe** no deployment (dados operacionais
   nunca são commitados — `.gitignore`);
2. Mesmo que fosse commitado, **não há como gravar**: cada venda/checkout
   falharia ou perder-se-ia no próximo cold start;
3. Multi-instância/regiões divergiriam (cada função teria a sua cópia).

Isto violaria o requisito n.º 1 da plataforma — **integridade dos dados** — e é
incompatível com documentos fiscais (a cadeia de hashes exige base única e
durável). **Não faça deploy na Vercel sem migrar a base de dados.**

### O que seria preciso para a Vercel (opção B — migração)

| Passo | Trabalho |
|---|---|
| Base de dados externa | **Turso/libSQL** (SQL quase idêntico ao SQLite) ou Postgres (Neon/Vercel Postgres) |
| Camada de dados | `lib/db/client.ts` + todos os serviços passam de API **síncrona** (better-sqlite3) para **assíncrona** — refactor grande e transversal (`db.prepare().get()` → `await`) |
| Transações | `BEGIN IMMEDIATE` → transações interativas do driver escolhido |
| Testes | Os 67 testes atuais correm contra SQLite em memória — teriam de acompanhar |
| Deploy | Import do repo GitHub na Vercel (build já passa: `next.config.ts` sem dependências de FS em runtime, exceto a BD) |

Estimativa: vários dias de trabalho. Só avançar se o destino for mesmo
serverless. Alternativa pragmática: **VPS/Fly.io com o Dockerfile incluído**
(opção A) — zero alterações de código.

---

## ✅ Opção A (recomendada) — Docker em VPS / Fly.io / Railway / Render

O repositório inclui `Dockerfile` (multi-stage, Node 22, better-sqlite3
compilado no build) e `docker-compose.yml` (volume persistente `vantyx-data`
montado em `/data`).

> Nota: o Dockerfile segue o padrão oficial Next.js multi-stage; não foi
> possível testar o `docker build` no sandbox de desenvolvimento (Docker
> indisponível) — o modo de produção foi validado com `next start` diretamente.

### A.1 — VPS (Hetzner, DigitalOcean, OVH, …) ou máquina própria

```bash
# no servidor (Docker + Compose instalados)
git clone https://github.com/valdimiroilidio3/VANTYX-.git vantyx
cd vantyx && git checkout arena/954058e6-vantyx   # ou main, quando feito merge
docker compose up -d --build

# opcional: dados de demonstração (só em modo demo!)
docker compose exec vantyx npm run seed:demo
```

A app fica em `http://IP:3000`. **Coloque HTTPS à frente** (obrigatório — os
cookies de sessão são `Secure` em produção):

- **Caddy** (mais simples): `caddy reverse-proxy --from seudominio.pt --to localhost:3000`
- **Nginx + certbot**: configuração habitual de reverse proxy + Let's Encrypt.

### A.2 — Fly.io (volume persistente)

```bash
fly launch --no-deploy --copy-config   # gera fly.toml a partir do Dockerfile
fly volumes create vantyx_data --size 1 --region mad   # região à escolha
fly deploy
```

`fly.toml` mínimo:

```toml
app = "vantyx"
primary_region = "mad"

[build]
  dockerfile = "Dockerfile"

[mounts]
  source = "vantyx_data"
  destination = "/data"

[env]
  NODE_ENV = "production"
  VANTYX_DB_PATH = "/data/vantyx.db"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false      # importante: single-instância com SQLite
  auto_start_machines = true

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

**Mantenha 1 única máquina/instância** (SQLite local não é multi-nó).

### A.3 — Railway / Render

- Railway: novo projeto a partir do repo → deteta o Dockerfile → adicionar
  **Volume** montado em `/data` → variável `VANTYX_DB_PATH=/data/vantyx.db`.
- Render: novo **Web Service** (Docker) → **Persistent Disk** montado em
  `/data` → mesma variável de ambiente.

---

## ✅ Opção C — Servidor local / LAN (sem cloud)

```bash
npm ci
npm run build
npm start            # http://localhost:3000
# primeira vez (opcional): npm run seed:demo
```

Para acesso LAN: a app já escuta em `0.0.0.0`. HTTPS local via Caddy/Traefik
recomendado (cookies `Secure`). Ideal para loja única.

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VANTYX_DB_PATH` | Não (default `data/vantyx.db`) | Caminho absoluto do ficheiro SQLite. Em Docker: `/data/vantyx.db` |
| `NODE_ENV` | Sim em produção | `production` ativa cookies `Secure` (HTTPS obrigatório) |
| `VANTYX_LLM_API_KEY` | Não | Ativa o assistente IA (sem chave = estado honesto `not_configured`) |
| `VANTYX_LLM_MODEL` / `VANTYX_LLM_BASE_URL` | Não | Modelo/endpoint do assistente |

**Nunca** commitar chaves/segredos (regra do projeto). Não há segredo de
sessão em env — as sessões vivem na BD (tokens só em SHA-256).

## Migrações, seed e backups

- **Migrações:** aplicadas automaticamente no primeiro acesso à BD
  (`getDb()` → `ensureMigrations`). Manual: `npm run db:migrate`.
- **Seed demo:** `npm run seed:demo` — idempotente (ignora orgs demo existentes);
  cria apenas dados marcados `demo=1`, separados dos reais.
- **Backups:** copiar o ficheiro da BD de forma atómica:
  ```bash
  sqlite3 /data/vantyx.db ".backup '/backups/vantyx-$(date +%F).db'"
  ```
  (checkpoint WAL incluído). Cron diário recomendado + teste de restauro.
- **Atualizações:** `git pull && docker compose up -d --build` — as migrações
  correm sozinhas no arranque.

## Checklist de segurança pós-deploy

1. HTTPS ativo (cookies são `Secure` em produção — sem HTTPS o login falha).
2. Criar a organização real via `/onboarding` (link "Criar organização" no login).
3. Preencher NIF real + região fiscal em Definições → Fiscal (QR Code só emite
   com NIF; ATCUD só com código atribuído pela AT).
4. Criar utilizadores mínimos necessários (papéis em Definições → Equipa);
   todas as permissões são verificadas no servidor.
5. Backup automático da BD (ver acima) + monitorização de disco.
6. **Estado fiscal:** o software NÃO é certificado pela AT — candidatura e
   passos em `docs/CERTIFICACAO-AT.md`.
