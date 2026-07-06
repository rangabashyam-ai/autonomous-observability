// Re-export trace span type; parsing is done on the backend.
export type { TraceSpan } from './services/vm';
export { getVmTraceSpans } from './services/vm';

import { getVmTraceSpans, type TraceSpan } from './services/vm';

/** Fetch flat spans from backend — no OTLP parsing on the frontend. */
export async function getTraceById(traceId: string): Promise<TraceSpan[]> {
  return getVmTraceSpans(traceId);
}
