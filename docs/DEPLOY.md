# VANTYX® — Guia de Lançamento (Deployment)

> **Data:** 2026-10-15 · A camada de dados usa **libSQL** (`@libsql/client`):
> em produção/serverless liga a uma base **Turso** remota; em desenvolvimento
> usa um ficheiro SQLite local. Build de produção, testes (67/67) e smoke
> completo validados após a migração.

---

## ✅ Opção A (recomendada para cloud) — Vercel + Turso

A app é compatível com serverless: nenhum dado depende do sistema de
ficheiros; a BD vive no Turso (libSQL gerido, plano gratuito suficiente para
começar).

### 1. Criar a base de dados (conta Turso — gratuita)

```bash
# instalar CLI (ver https://docs.turso.tech)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup            # criar conta
turso db create vantyx       # criar base
turso db show vantyx --url   # → libsql://vantyx-<user>.turso.io
turso db tokens create vantyx --authorization write
```

Guarda: **URL** (`libsql://...`) e **TOKEN** (write).

### 2. Aplicar as migrações na base remota (a partir da tua máquina)

```bash
git clone https://github.com/valdimiroilidio3/VANTYX-.git && cd VANTYX-
npm ci
TURSO_DATABASE_URL="libsql://vantyx-<user>.turso.io" \
TURSO_AUTH_TOKEN="<token>" \
  npm run db:migrate
```

### 3. Deploy na Vercel

1. [vercel.com/new](https://vercel.com/new) → importar o repositório
   `valdimiroilidio3/VANTYX-` → branch `arena/954058e6-vantyx` (ou `main`
   após merge).
2. Framework: Next.js (detetado automaticamente). Sem configuração extra.
3. **Environment Variables** (Settings → Environment Variables):
   - `TURSO_DATABASE_URL` = `libsql://vantyx-<user>.turso.io`
   - `TURSO_AUTH_TOKEN` = token de escrita
   - (opcional) `VANTYX_LLM_API_KEY` para o assistente IA
4. Deploy. Ao abrir, criar a organização em **/onboarding** ("Criar
   organização" na página de login).

### Notas Vercel

- **Região:** escolhe uma região Vercel próxima da região Turso (a latência
  por query é o custo do serverless; a app faz várias queries por request).
- **1 instância ≠ problema:** ao contrário do SQLite local, o Turso é
  multi-cliente — várias funções/regions podem escrever em concorrência
  (transações geridas pelo servidor).
- **Tokens:** nunca commitar; só em env vars da Vercel (secret).
- **Seed demo na remota:** `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run seed:demo`
  (apenas para avaliação — dados demo ficam na mesma base; em produção real,
  não usar).

---

## ✅ Opção B — Docker em VPS / Fly.io / Railway / Render

Para quem prefere disco próprio (um único ficheiro SQLite local, sem serviço
externo). O `Dockerfile` (multi-stage, Node 22, sem compilação nativa) e
`docker-compose.yml` (volume `vantyx-data` em `/data`) estão no repositório.

```bash
git clone https://github.com/valdimiroilidio3/VANTYX-.git vantyx && cd vantyx
docker compose up -d --build
# dados demo (opcional): docker compose exec vantyx npm run seed:demo
```

Sem `TURSO_DATABASE_URL`, a app usa `VANTYX_DB_PATH` (no container:
`/data/vantyx.db`). **HTTPS à frente é obrigatório** (cookies `Secure` em
produção): Caddy `reverse-proxy --from seudominio.pt --to localhost:3000`
ou Nginx+certbot. Fly.io/Railway/Render: montar volume/disco em `/data`
(exemplo `fly.toml` no histórico deste guia; single instance com SQLite local).

## ✅ Opção C — Servidor local / LAN

```bash
npm ci && npm run build && npm start   # http://localhost:3000
```

---

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | Base remota libSQL (`libsql://...`). Se definida, tem prioridade |
| `TURSO_AUTH_TOKEN` | Token de escrita da base Turso |
| `VANTYX_DB_PATH` | Modo local: caminho do SQLite (default `data/vantyx.db`; `:memory:` para testes) |
| `NODE_ENV=production` | Ativa cookies `Secure` (HTTPS obrigatório) |
| `VANTYX_LLM_API_KEY` / `_MODEL` / `_BASE_URL` | Assistente IA (opcional; sem chave = estado honesto `not_configured`) |

## Migrações, seed e backups

- **Migrações:** aplicadas automaticamente na primeira operação
  (`getDb().ready()`); manual: `npm run db:migrate` (com as env vars do destino).
- **Seed demo:** `npm run seed:demo` — idempotente; dados marcados `demo=1`.
- **Backups (Turso):** `turso db shell <nome> ".dump" > backup-$(date +%F).sql`
  ou criar base secundária/pitr conforme plano. **Backups (local):**
  `sqlite3 data/vantyx.db ".backup 'backups/vantyx-$(date +%F).db'"`.

## Checklist de segurança pós-deploy

1. HTTPS ativo (cookies `Secure` — sem HTTPS o login falha em produção).
2. Criar a organização real via `/onboarding`.
3. Preencher NIF real + região fiscal em Definições → Fiscal (QR Code só emite
   com NIF; ATCUD só com código atribuído pela AT).
4. Utilizadores mínimos necessários; permissões verificadas no servidor.
5. Backups automáticos + teste de restauro.
6. **Estado fiscal:** software NÃO certificado pela AT — candidatura e passos
   em `docs/CERTIFICACAO-AT.md`.
