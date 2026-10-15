# VANTYX® — Dossier de Certificação AT (Portugal)

> **Estado atual (2026-10-15): O VANTYX NÃO é software certificado pela Autoridade
> Tributária e Aduaneira.** A implementação técnica abaixo descrita segue as
> especificações oficiais, mas a certificação é um **processo administrativo da
> empresa produtora junto da AT** que ainda não foi iniciado/concluído. Até ao
> deferimento, os documentos emitidos apresentam a menção honesta
> «AINDA NÃO certificado pela AT» e nenhum campo (`HashControl`, ATCUD,
> `SoftwareCertificate` SAF-T) reclama um número de certificado inexistente.

Este documento é o dossier de preparação da candidatura e o mapa
"requisito legal → implementação → evidência de teste".

---

## 1. Enquadramento legal

| Diploma | Objeto |
|---|---|
| Art. 123.º CIRC (n.º 9) | Obrigação de programas de faturação certificados |
| Portaria n.º 363/2010 (com Portaria 22-A/2012) | Regulamenta a certificação prévia; requisitos (art. 3.º), obrigações do produtor (art. 4.º), emissão do certificado (art. 5.º), elementos a imprimir (art. 7.º) |
| Despacho n.º 8632/2014 (DGITA) | Regras técnicas do hash: string a assinar, SHA-1, representação Base-64, 4 primeiros caracteres impressos |
| Portaria n.º 321-A/2007 | Ficheiro SAF-T (PT) — exportação obrigatória (requisito do art. 3.º a) da Port. 363) |
| Portaria n.º 195/2020 + Despacho n.º 351/2019 | ATCUD e QR Code (código de barras bidimensional) nos documentos |
| Especificações técnicas AT do QR (v1.1, out/2020) | Estrutura dos campos A–S, ECC "M", modo Byte, versão mínima 9 |

## 2. Requisitos técnicos (art. 3.º Port. 363/2010) → implementação

### 2.1 Exportação SAF-T (PT)
- **Implementado:** `lib/fiscal/saft-pt.ts` gera o ficheiro SalesInvoices
  (schema 1.04_01) com `Header`, `MasterFiles` (Customer/Product/TaxTable) e
  `SourceDocuments`. Endpoint: `GET /api/fiscal/saft-pt?from=&to=`
  (permissão `fiscal.manage`); download também em Definições → Fiscal.
- **Por validar:** passagem no **validador oficial da AT**
  (https://info.portaldasfinancas.gov.pt) com dados reais. Limitações atuais
  documentadas no próprio módulo: sem tabela de `Payments` (recibos) e sem
  movimentos de outras naturezas (4.2/4.4); morada do emitente e dados do
  produtor saem da configuração.

### 2.2 Identificação do registo dos documentos (assinatura/hash)
- **Implementado:** `lib/domain/fiscal.ts` — `atHash()`:
  - string a assinar: `InvoiceDate;SystemEntryDate;InvoiceNo;GrossTotal;HashAnterior`
    (Despacho 8632/2014), datas `AAAA-MM-DD` / `AAAA-MM-DDTHH:MM:SS`,
    `InvoiceNo` no formato SAF-T (`FT VD/143`), montante com 2 casas e ponto decimal;
  - algoritmo **SHA-1**, resultado em **Base-64**;
  - encadeamento **por tipo de documento, série e exercício**
    (`lastChainHash(db, orgId, docType, fiscalYear)` ordenado por `sequence_number`);
    primeiro documento da série/exercício usa `HashAnterior` vazio;
  - **vetor de teste oficial:** SHA-1 de `"2019-08-12;2019-08-12T10:30:00;FT VD/1;0.80;"`
    = `3qFd73AKNvOno9JS+EH5zDSmBWA=` — reproduzido em `tests/domain.test.ts`;
  - 4 primeiros caracteres impressos nos documentos (`atHashPrintable`) e no
    campo Q do QR — talão visual e impressão (`components/pos/receipt-modal.tsx`).
- **Nota legal:** o art. 3.º b) refere "cifra assimétrica"; o Despacho
  8632/2014 fixou as regras atualmente aceites (SHA-1/Base-64). Em candidatura,
  confirmar com a AT a formulação vigente.

### 2.3 Controlo de acesso por utilizador (art. 3.º c))
- **Implementado:** autenticação por utilizador (scrypt + sessões), permissões
  verificadas server-side (`requirePermission`), trilha `audit_logs` das
  operações críticas, multi-tenancy por `org_id` em todas as queries.

### 2.4 Inalterabilidade da informação fiscal (art. 3.º d))
- **Implementado:** documentos finalizados nunca são editados — anulações e
  devoluções geram **NC encadeada** com referência ao original
  (`createReturn`), estado `voided` com motivo obrigatório, e a cadeia de
  hashes torna adulterações detetáveis. Sem função de reescrita de vendas.

### 2.5 Elementos a imprimir (art. 7.º)
- **Implementado no talão/impressão:** número do documento, data, 4 caracteres
  da assinatura (`Hash: XXXX`), ATCUD quando o código de validação da série foi
  comunicado, QR Code, e a expressão «Processado por programa certificado
  n.º …/AT» **apenas** quando existe número de certificado real configurado
  (Definições → Fiscal); caso contrário, menção explícita de não-certificação.

### 2.6 ATCUD (Portaria 195/2020, art. 3.º; Despacho 351/2019)
- **Implementado:** `document_series.atcud_validation_code` guarda o código de
  validação atribuído pela AT a cada série comunicada; `buildAtcud()` produz
  `códigoValidação-sequencial`. **Sem código comunicado, o sistema não emite
  ATCUD nem inventa um** (campo `atcud = NULL`, campo H do QR omitido).
- **Operação:** comunicar as séries no Portal das Finanças (1–31 de dezembro
  de cada ano, ou no início de atividade) e registar o código recebido em
  Definições → Fiscal → série.

### 2.7 QR Code (Portaria 195/2020 + especificações técnicas v1.1)
- **Implementado:** `buildQrString()` monta os campos A–S separados por `*`:
  A (NIF emitente), B (NIF cliente; `999999990` para consumidor final),
  C (PT), D (tipo SAF-T), E (estado N/A), F (data AAAAMMDD), G (InvoiceNo),
  H (ATCUD, só com código real), I/J/K (espaços fiscais PT/PT-AC/PT-MA com
  bases e IVA por escalão — RED/INT/NOR/ISE), N (imposto), O (total com
  imposto), Q (4 caracteres do hash), R (n.º certificado, só se existir),
  S (outras informações, nunca contém `*`). Campos opcionais sem valor são
  omitidos; pelo menos um bloco regional é sempre emitido.
- **Renderização:** `components/qr-code.tsx` — SVG, ECC **"M"**, modo Byte,
  **versão mínima 9 (53×53 módulos)**, margem silenciosa de 4 módulos; na
  impressão física respeitar ≥30×30 mm.
- **Evidência de teste:** o **Exemplo 2 oficial** das especificações da AT é
  reproduzido byte-a-byte em `tests/domain.test.ts`
  (`A:123456789*B:999999990*C:PT*D:FS*E:N*F:20190812*G:FS CDVF/12345*H:CDF7T5HD-12345*I1:PT*I7:0.65*I8:0.15*N:0.15*O:0.80*Q:YhGV*R:9999*S:NU;0.80`).

## 3. Processo de candidatura (art. 4.º e 5.º Port. 363/2010)

1. **Empresa produtora** com atividade CAE adequada (desenvolvimento de
   software) e situação fiscal regularizada.
2. Preparar **declaração de modelo oficial** (modelo aprovado por despacho do
   Ministro das Finanças) com identificação da empresa e do programa
   (nome «VANTYX», versão, sistemas operativos/ambientes suportados).
3. Submeter à AT (via Portal das Finanças / e-balcão, serviço «Certificação de
   programas informáticos») com a documentação técnica: arquitetura,
   **dicionário de dados** (a produzir formalmente a partir do schema em
   `lib/db/migrations/` — pendente), descrição da cadeia de hash, credenciais
   de demonstração.
4. A AT emite o certificado em **30 dias**, podendo solicitar **testes de
   conformidade** (o produtor disponibiliza exemplar do programa). Preparar:
   - demonstração da cadeia de hashes (ver §2.2 e testes);
   - ficheiro SAF-T de exemplo validado no validador oficial;
   - demonstração da impossibilidade de edição de documentos emitidos;
   - QR/ATCUD com códigos de teste atribuídos pela AT.
5. Recebido o número de certificado, registá-lo em **Definições → Fiscal →
   N.º de certificado AT**; o sistema passa a imprimir «Processado por
   programa certificado n.º X/AT» e `HashControl = X.1`.
6. Comunicar as séries documentais para obter os **códigos de validação
   ATCUD** e registá-los por série na mesma página.
7. A versão certificada deve manter os requisitos em **todas** as atualizações
   — qualquer alteração relevante implica comunicação à AT.

## 4. Lacunas conhecidas (fase seguinte)

| Lacuna | Impacto | Plano |
|---|---|---|
| SAF-T sem tabela de Payments (recibos) | Limita o âmbito a SalesInvoices | Adicionar `SourceDocuments/Payments` quando recibos autónomos forem emitidos |
| Comunicação de guias de transporte (webservice AT) | GT não comunicadas | Adaptador `lib/integrations` + estado `not_configured` até credenciais reais |
| Motivos de isenção por produto (M-codes) | Linhas isentas usam M99 genérico | Campo `exemption_reason` por produto/variante |
| Assinatura RSA (leitura literal do art. 3.º b)) | Despacho 8632/2014 normalizou SHA-1 | Confirmar formulação com a AT na candidatura |
| Multi-região por linha (vendas Continente+Açores no mesmo doc) | QR usa região da organização | Suportar blocos I/J/K mistos quando houver filiais multi-região |

## 5. Fontes oficiais

- Portaria 363/2010 (consolidada): https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/diplomas_legislativos/Documents/Portaria_363_2010.pdf
- Portaria 22-A/2012: https://files.diariodarepublica.pt/1s/2012/01/01701/0000200005.pdf
- Despacho 8632/2014: https://files.diariodarepublica.pt/2s/2014/07/00000010900.pdf (regras do hash)
- Especificações técnicas QR Code (v1.1): https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/Faturacao_QR_Code/Documents/QR_Code%20Technical%20Specifications_Eng.pdf
- Portaria 195/2020 (ATCUD/QR): https://files.diariodarepublica.pt/1s/2020/06/11900/000021195.pdf
- Validador SAF-T: área «Apoio ao contribuinte → Faturação → SAF-T» do Portal das Finanças
- Lista de programas certificados: https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/Faturacao/Paginas/default.aspx
