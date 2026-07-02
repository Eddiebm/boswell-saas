export type MemoryEvent = {
  id: string;
  eventType: string;
  title: string;
  summary: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};
