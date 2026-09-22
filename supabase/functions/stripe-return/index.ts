// stripe-return: receives Stripe's redirect after payment, captures session_id,
// then does a direct HTTP 302 redirect to localhost with the session_id intact.
Deno.serve({ verifyJwt: false }, async (req: Request) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id') || '';
  // No caller in the current codebase omits `redirect` (grepped clean), but this is a
  // safety net in case something outside this repo (a Stripe Dashboard-configured URL,
  // an old bookmark) hits this endpoint without it -- fail safe to production, not a dead
  // local dev port.
  const redirectTo = url.searchParams.get('redirect') || 'https://propbook.pro/app/';

  console.log('[stripe-return] HIT! session_id:', sessionId);

  // Build the localhost redirect URL with BOTH paid=true AND the session_id
  const targetUrl = new URL(redirectTo.replace(/\?.*$/, ''));
  targetUrl.searchParams.set('paid', 'true');
  targetUrl.searchParams.set('session_id', sessionId);

  return Response.redirect(targetUrl.toString(), 302);
});
