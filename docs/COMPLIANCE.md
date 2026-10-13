# VANTYX® — Estado de Conformidade (Compliance)

> **Data:** 2026-10-13 · **Âmbito:** mercado português (PT) · **Princípio:** nunca declarar
> conformidade/certificação sem validação. Tudo o que não foi validado está marcado
> como **"Por validar"** ou **"Não implementado"**.

## 1. Fiscalidade (Portugal — AT)

| Requisito | Estado | Notas |
|---|---|---|
| Certificação de software (Portaria n.º 363/2010) | **Não certificado** | O VANTYX **não** é software certificado pela AT. A certificação exige processo próprio (requisitos de segurança, hash chain auditável, submissão à AT). Não utilize em produção fiscal sem concluir esse processo. |
| Encadeamento de hash dos documentos (SHA-256) | **Implementado — Por validar** | Cada venda guarda `hash` (SHA-256 sobre campos do documento + `prev_hash` do documento anterior da organização). A lógica está testada (`tests/domain.test.ts`, `tests/integration.test.ts`), mas a correspondência exata com o formato exigido pela AT (campo `hash` no SAF-T, regras do `HashControl`) **tem de ser validada com um contabilista/auditor**. |
| ATCUD | **Placeholder — Por validar** | `internalDocumentCode()` gera `<seriesId>-<sequence>`. **Não** existe validação de série junto da AT nem atribuição de código de validação real. Os talões imprimem "ATCUD: pending certification". |
| QR Code em faturas (Portaria n.º 195/2020) | **Não implementado** | O layout do recibo não inclui o QR fiscal. |
| SAF-T (PT) — exportação | **Não implementado** | Não existe exportação do ficheiro SAF-T de faturação nem de contabilidade. |
| Cálculo de IVA (preços com IVA incluído) | **Implementado — Por validar** | Split por linha com arredondamento inteiro (`roundHalfAway`), breakdown por taxa (6%/13%/23%) e arredondamento da diferença para o maior peso. Validar regras de arredondamento por documento vs. por linha com contabilista. |
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

1. Validar com Contabilista Certificado: formato do hash, regras de arredondamento de IVA por documento, séries e tipos de documento usados (FT/NC/FR?).
2. Implementar exportação SAF-T (PT) de faturação e testar com o validador oficial da AT.
3. Implementar QR Code fiscal (Portaria 195/2020) nos documentos impressos.
4. Pedir o código de validação de série ATCUD à AT e substituir o placeholder.
5. Submeter o software a auditoria de segurança para certificação (Portaria 363/2010) antes de uso fiscal em produção.

**Aviso:** até todos os passos acima estarem concluídos e validados, o VANTYX **não deve**
ser apresentado como fiscalmente certificado nem usado como tal em produção.
