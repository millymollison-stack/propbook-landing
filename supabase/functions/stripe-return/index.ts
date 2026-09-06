// stripe-return: receives Stripe's redirect after payment, captures session_id,
// then does a direct HTTP 302 redirect to localhost with the session_id intact.
Deno.serve({ verifyJwt: false }, async (req: Request) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id') || '';
  const redirectTo = url.searchParams.get('redirect') || 'http://localhost:5174/';

  console.log('[stripe-return] HIT! session_id:', sessionId);

  // Build the localhost redirect URL with BOTH paid=true AND the session_id
  const targetUrl = new URL(redirectTo.replace(/\?.*$/, ''));
  targetUrl.searchParams.set('paid', 'true');
  targetUrl.searchParams.set('session_id', sessionId);

  return Response.redirect(targetUrl.toString(), 302);
});
