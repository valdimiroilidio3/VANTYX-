/**
 * Typed in-process domain event bus.
 * Modules never import each other's internals: they emit/consume these
 * contracts. Handlers run after the emitting transaction commits
 * (services call emit() outside the tx closure) and failures are isolated.
 */

export interface DomainEventMap {
  "sale.completed": {
    orgId: string;
    saleId: string;
    branchId: string;
    totalCents: number;
    createdBy?: string;
    channel: string;
  };
  "sale.voided": { orgId: string; saleId: string; reason: string; by?: string };
  "sale.returned": {
    orgId: string;
    returnId: string;
    saleId: string;
    totalCents: number;
  };
  "stock.changed": {
    orgId: string;
    productId: string;
    variantId?: string | null;
    warehouseId: string;
    qtyMilli: number;
    reason: string;
  };
  "stock.below_min": {
    orgId: string;
    productId: string;
    variantId?: string | null;
    productName: string;
    qtyMilli: number;
    reorderPointMilli: number;
  };
  "stock.negative": {
    orgId: string;
    productId: string;
    productName: string;
    qtyMilli: number;
  };
  "batch.expiring": {
    orgId: string;
    batchId: string;
    productName: string;
    expiryDate: number;
    risk: "critical" | "soon" | "expired";
  };
  "cash.session_opened": { orgId: string; sessionId: string; by?: string };
  "cash.session_closed": {
    orgId: string;
    sessionId: string;
    differenceCents: number;
  };
  "purchase.approval_required": {
    orgId: string;
    poId: string;
    poNumber: string;
    totalCents: number;
  };
  "purchase.received": {
    orgId: string;
    poId: string;
    receiptId: string;
    discrepancies: number;
  };
  "kitchen.ticket_sent": {
    orgId: string;
    ticketId: string;
    orderId: string;
    station: string;
  };
  "kitchen.ticket_ready": { orgId: string; ticketId: string };
  "rule.blocked": {
    orgId: string;
    ruleKey: string;
    reason: string;
    refType?: string;
    refId?: string;
  };
  "sync.conflict": { orgId: string; entity: string; detail: string };
}

export type DomainEventName = keyof DomainEventMap;

type Handler<T> = (payload: T) => void | Promise<void>;

const handlers = new Map<string, Handler<never>[]>();

export function onDomainEvent<K extends DomainEventName>(
  event: K,
  handler: Handler<DomainEventMap[K]>,
): () => void {
  const list = handlers.get(event) ?? [];
  list.push(handler as Handler<never>);
  handlers.set(event, list);
  return () => offDomainEvent(event, handler);
}

export function offDomainEvent<K extends DomainEventName>(
  event: K,
  handler: Handler<DomainEventMap[K]>,
): void {
  const list = handlers.get(event) ?? [];
  handlers.set(
    event,
    list.filter((h) => h !== (handler as Handler<never>)),
  );
}

/** Fire-and-forget emit with per-handler error isolation. */
export function emitDomainEvent<K extends DomainEventName>(
  event: K,
  payload: DomainEventMap[K],
): void {
  const list = handlers.get(event) ?? [];
  for (const handler of list) {
    try {
      const result = (handler as Handler<DomainEventMap[K]>)(payload);
      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`[events] handler failed for ${event}`, err);
        });
      }
    } catch (err) {
      console.error(`[events] handler threw for ${event}`, err);
    }
  }
}
