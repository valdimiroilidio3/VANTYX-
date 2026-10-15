import type { Migration } from "../migrate";

/**
 * 004 — Camada fiscal AT (Portugal): colunas para conformidade com a
 * Portaria 363/2010 (hash SHA-1 Base-64 por série/exercício + HashControl),
 * Portaria 195/2020 (ATCUD por série) e exportação SAF-T (PT).
 *
 * Aditivo e não destrutivo: documentos existentes mantêm os hashes antigos
 * (histórico); novos documentos passam a usar o formato legal AT.
 */
export const migration004FiscalAt: Migration = {
  id: "004_fiscal_at",
  name: "AT fiscal columns: hash_control, atcud, series validation code",
  async up(db) {
    await db.exec(`
ALTER TABLE sales ADD COLUMN hash_control TEXT;
ALTER TABLE sales ADD COLUMN atcud TEXT;
ALTER TABLE returns ADD COLUMN hash_control TEXT;
ALTER TABLE returns ADD COLUMN atcud TEXT;
ALTER TABLE document_series ADD COLUMN atcud_validation_code TEXT;
`);
  },
};
