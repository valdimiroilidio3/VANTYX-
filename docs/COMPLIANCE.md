# VANTYX® — Estado de Conformidade (Compliance)

> **Data:** 2026-10-15 · **Âmbito:** mercado português (PT) · **Princípio:** nunca declarar
> conformidade/certificação sem validação. Tudo o que não foi validado está marcado
> como **"Por validar"** ou **"Não implementado"**.

## 1. Fiscalidade (Portugal — AT)

| Requisito | Estado | Notas |
|---|---|---|
| Certificação de software (Portaria n.º 363/2010) | **Não certificado** | O VANTYX **não** é software certificado pela AT — a certificação é um processo administrativo da empresa produtora (art. 4.º/5.º). Dossier de preparação e lacunas: `docs/CERTIFICACAO-AT.md`. Os documentos declaram explicitamente a não-certificação até existir número real. |
| Assinatura dos documentos (SHA-1/Base-64, Despacho 8632/2014) | **Implementado conforme spec — Por validar oficialmente** | `atHash()`: string `InvoiceDate;SystemEntryDate;InvoiceNo;GrossTotal;HashAnterior`, SHA-1 em Base-64, encadeado por **tipo+série+exercício** (primeiro doc → `HashAnterior` vazio), 4 primeiros caracteres impressos e no QR (campo Q). Vetor oficial de teste reproduzido (`tests/domain.test.ts`). `HashControl` = `<n.º certificado>.1` só com certificado real, senão `0`/nulo. |
| ATCUD (Portaria 195/2020, Despacho 351/2019) | **Implementado — exige código real da AT** | `document_series.atcud_validation_code` guarda o código atribuído pela AT a cada série comunicada; ATCUD = `código-sequencial`. Sem comunicação à AT o campo é NULL e o QR omite H — **nunca é inventado**. Registo em Definições → Fiscal. |
| QR Code em documentos (Portaria n.º 195/2020) | **Implementado conforme spec — Por validar oficialmente** | Campos A–S segundo as especificações técnicas AT v1.1 (ECC "M", Byte, versão ≥9, blocos PT/PT-AC/PT-MA, `999999990` para consumidor final). **Exemplo 2 oficial reproduzido byte-a-byte** em teste. Render SVG (`components/qr-code.tsx`) no talão e na impressão (respeitar ≥30×30 mm no papel). |
| SAF-T (PT) — exportação | **Implementado (SalesInvoices 1.04_01) — Por validar** | `lib/fiscal/saft-pt.ts` + `GET /api/fiscal/saft-pt` (download em Definições → Fiscal). Falta passagem no validador oficial da AT, tabela de Payments e motivos de isenção por produto — ver `docs/CERTIFICACAO-AT.md` §4. |
| Cálculo de IVA (preços com IVA incluído) | **Implementado — Por validar** | Split por linha com arredondamento inteiro (`roundHalfAway`), breakdown por taxa e região fiscal (PT 6/13/23 · PT-AC 4/9/16 · PT-MA 5/11,25/22, configurável em Definições → Fiscal). Validar regras de arredondamento por documento vs. por linha com contabilista. |
| Notas de crédito (NC) para devoluções/anulações | **Implementado** | Documentos de correção geram NC encadeada; documentos finalizados nunca são editados silenciosamente (apenas mecanismos legais de correção + trilha de auditoria). |
| Séries documentais por ano/tipo (FT/NC/PC/…) | **Implementado** | `document_series` com numeração sequencial por organização/ano/tipo. |

## 2. Dados pessoais (RGPD)

| Requisito | Estado | Notas |
|---|---|---|
| Base legal / minimização | **Parcial — Por validar** | Clientes guardam apenas dados operacionais (nome, contacto, NIF, morada, notas). Sem campos sensíveis. |
| Direitos do titular (acesso/retificação/apagamento) | **Implementado (interno)** | `data_requests` + serviço CRM: exportação e anonimização de dados do cliente por organização. O enquadramento legal (prazos, respostas formais) é **Por validar**. |
| Passwords | **Implementado** | scrypt (KDF memory-hard) com sal por utilizador; nunca guardadas em claro. |
| Tokens de sessão | **Implementado** | Guardados como SHA-256 (o token em claro nunca persiste). |
| Trilha de auditoria | **Implementado** | `audit_logs` para operações críticas (vendas bloqueadas por regras, ajustes de stock, aprovações, alterações de perfil/setor, etc.). |
| DPO / registo de tratamentos (art. 30.º) | **Não implementado** | Documentação organizacional fora do âmbito do software. |

## 3. Pagamentos

| Requisito | Estado | Notas |
|---|---|---|
| Dados de cartões (PAN) | **Nunca armazenados** | Por desenho: o sistema regista apenas `method_key`, montante e estado. Nenhum campo guarda números de cartão. |
| Integração com TPA / gateways | **Adaptadores com estado honesto** | O registo de integrações (`lib/integrations/registry.ts`) expõe `not_configured` quando não há credenciais — nunca simula ligação. Pagamentos eletrónicos sem integração configurada são registados como confirmados pelo operador (responsabilidade do utilizador). |
| PCI-DSS | **Fora do âmbito** | Como não há captura/transmissão de dados de cartão pelo VANTYX, a obrigação recai no fornecedor do terminal/gateway. **Por validar** caso se implemente integração direta. |

## 4. Outras matérias

- **Modo demo:** dados demo vivem apenas em organizações marcadas `demo=1` (criadas por `npm run seed:demo`), separadas de organizações reais; logins demo usam domínio `@vantyx.demo`.
- **Multi-tenant:** todas as queries filtram por `org_id`; permissões verificadas **server-side** (`requirePermission`) além da UI. Testado em `tests/integration.test.ts` ("isolamento multi-tenant").
- **Offline-first:** operações críticas (pagamentos, faturação, saldos de crédito) nunca são dadas como confirmadas a partir de storage local; a sincronização usa `client_ref`/`idempotency_key` para deduplicação determinística.
- **IA (assistente/insights):** os insights são determinísticos e derivados de dados reais; previsões estão rotuladas como estimativas. Sem credenciais de fornecedor de IA, o estado é `not_configured` (nunca simulado).

## 5. Caminho para conformidade fiscal (próximos passos)

1. **Candidatura à AT** (Portaria 363/2010 art. 4.º/5.º) — passos, documentação
   e testes de conformidade em `docs/CERTIFICACAO-AT.md` §3.
2. Validar o SAF-T exportado no **validador oficial da AT**; completar tabela
   de Payments e motivos de isenção por produto.
3. Validar com Contabilista Certificado: séries/tipos de documento usados
   (FT vs FS), arredondamentos de IVA, menções impressas.
4. Comunicar as séries documentais (1–31 dez) e registar os códigos de
   validação ATCUD atribuídos pela AT.
5. Adaptador de comunicação de guias de transporte (webservice AT) — estado
   honesto `not_configured` até existirem credenciais reais.
4. Pedir o código de validação de série ATCUD à AT e substituir o placeholder.
5. Submeter o software a auditoria de segurança para certificação (Portaria 363/2010) antes de uso fiscal em produção.

**Aviso:** até todos os passos acima estarem concluídos e validados, o VANTYX **não deve**
ser apresentado como fiscalmente certificado nem usado como tal em produção.
