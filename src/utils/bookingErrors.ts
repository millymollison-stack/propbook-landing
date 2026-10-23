// David 2026-10-19: shared error-message helpers for the booking
// approve/deny flow. Two real bugs this fixes:
//
// 1. supabase-js's functions.invoke() wraps a non-2xx Edge Function response
//    in a FunctionsHttpError whose own .message is always the generic
//    "Edge Function returned a non-2xx status code" -- the function's real
//    JSON body (e.g. "Can't deny -- this booking was already captured/
//    charged. Use the refund action instead.") is only reachable via
//    error.context, which is the raw, unread Response object. Nothing was
//    reading it, so every capture-booking-payment failure showed that one
//    generic string no matter what actually went wrong.
// 2. The final catch blocks used `err instanceof Error ? err.message :
//    'Failed to update booking'`. Most thrown values here (Postgrest
//    errors, the FunctionsHttpError above, etc.) ARE Error instances, but
//    relying on instanceof as the only path to a message is fragile --
//    anything thrown that isn't a strict Error instance (a thrown string,
//    a plain {message} object, a cross-realm Error from a bundler/HMR
//    edge case) silently collapses to the unhelpful fallback with no way
//    to tell what really happened. errorMessage() below duck-types on a
//    usable .message instead of gating on instanceof.

/**
 * Given the {data, error} returned by supabase.functions.invoke(), resolve
 * the most useful human-readable message:
 * - the Edge Function's own `{ error: "..." }` body, if present in `data`
 * - otherwise, if `error` is a FunctionsHttpError (has a `.context` that's
 *   a Response), read and parse that response body for its `error` field
 * - otherwise whatever message the error object itself carries
 * Returns null if there's nothing to report (i.e. no error at all).
 */
export async function describeInvokeError(
  fnError: unknown,
  data: { error?: string } | null | undefined
): Promise<string | null> {
  if (data?.error) return String(data.error);
  if (!fnError) return null;

  const ctx = (fnError as any)?.context;
  if (ctx && typeof ctx.clone === 'function' && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // Response wasn't JSON (or already consumed) -- fall through.
    }
  }

  return errorMessage(fnError, null);
}

/**
 * Duck-typed message extraction: works for native Error, PostgrestError,
 * FunctionsHttpError, a thrown string, or a plain object with a .message --
 * instead of gating on `instanceof Error`, which misses anything that
 * merely looks like an error but isn't one by strict identity.
 */
export function errorMessage<T extends string | null>(err: unknown, fallback: T): string | T {
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}
