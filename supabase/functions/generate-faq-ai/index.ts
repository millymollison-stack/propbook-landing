// supabase/functions/generate-faq-ai/index.ts
//
// David 2026-10-17: generates faq-ai.txt for a property at publish time using
// Claude, instead of the generic boilerplate in generateFaqAiTxt() (still used
// as the fallback -- see siteDuplicationService.ts's generateFaqAiTxtAi()).
// Fed the property's own free-text sections (property_details / activities /
// local_area / getting_there) plus amenities + bed/bath/guest counts, so the
// Q&A is actually specific to the property instead of generic.
//
// Input (POST JSON body):
//   { title, location, address, property_details, activities, local_area,
//     getting_there, amenities, bedrooms, beds, bathrooms, max_guests,
//     price_per_night, slug }
// Output: { faq: string } on success, { error: string } on failure.
//
// No DB access needed here -- the caller already has a full property
// snapshot (fetchPropertyDataSnapshot), so this just takes that payload
// directly rather than re-querying Supabase.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SECTION_HEADINGS = [
  'Getting There',
  'Parking',
  'Local Area',
  'The Property',
  'Check-In and Check-Out',
  'Booking and House Rules',
];

interface FaqRequestBody {
  title?: string | null;
  location?: string | null;
  address?: string | null;
  property_details?: string | null;
  activities?: string | null;
  local_area?: string | null;
  getting_there?: string | null;
  amenities?: string[] | null;
  bedrooms?: number | null;
  beds?: number | null;
  bathrooms?: number | null;
  max_guests?: number | null;
  price_per_night?: number | null;
  slug?: string | null;
}

function buildPrompt(body: FaqRequestBody): string {
  const title = body.title || 'this property';
  const location = body.address || body.location || 'the property location';

  const propertyInfo = [
    `- ${title}, located in ${location}`,
    body.bedrooms != null ? `- ${body.bedrooms} bedroom(s)` : null,
    body.beds != null ? `- ${body.beds} bed(s)` : null,
    body.bathrooms != null ? `- ${body.bathrooms} bathroom(s)` : null,
    body.max_guests != null ? `- Sleeps up to ${body.max_guests} guest(s)` : null,
    body.price_per_night != null ? `- From $${body.price_per_night}/night` : null,
    body.amenities && body.amenities.length > 0 ? `- Amenities: ${body.amenities.join(', ')}` : null,
    body.property_details ? `- Property details (host-written): ${body.property_details}` : null,
  ].filter(Boolean).join('\n');

  const localAreaInfo = [
    body.local_area || null,
    body.activities ? `Activities nearby: ${body.activities}` : null,
  ].filter(Boolean).join('\n\n') || 'Please contact the host for the latest information.';

  const transportInfo = body.getting_there || 'Please contact the host for the latest information.';

  return `You are a vacation-rental content generator for a property website.

Using the property information provided below, create a complete guest-facing FAQ document for publishing on the property page.

Requirements:
1. Use exactly these section headings:
${SECTION_HEADINGS.map(h => `   - ${h}`).join('\n')}

2. Under each heading, create clear question-and-answer pairs in this format:
   Q: [Guest question]
   A: [Helpful, specific answer]

3. Make every answer:
   - Guest-friendly and easy to read
   - Specific to the property and neighbourhood
   - Accurate to the supplied information
   - Written in a warm but professional tone
   - Suitable for SEO and AI search
   - Free of invented claims -- never state a specific price, fee, policy, or timing that isn't given below

4. Include answers for these topics where the information is available:
   - Nearest airport routes and approximate journey times
   - Nearest Underground, Overground, train, and bus links
   - Routes into central London and popular destinations (only if the location is London -- otherwise the nearest equivalent major area)
   - Local restaurants, cafés, pubs, shops, parks, markets, and attractions
   - Historic or scenic nearby places
   - Parking availability, cost, restrictions, and timing
   - Number of guests, bedrooms, beds, bathrooms, and property layout
   - Wi-Fi, kitchen, heating, laundry, towels, linen, and work suitability
   - Check-in and check-out times
   - Access method, early check-in, late check-out, and emergency contact
   - Pets, smoking, parties, children, cancellation, deposit, and extra fees

5. If information for a topic is not available in what's supplied below, write:
   A: Please contact the host for the latest information.

6. Do not include internal notes, explanations, or commentary. Return only the finished FAQ document, starting with "FAQ — ${title}" on its own line.

Property information:
${propertyInfo}

Location and neighbourhood information:
${localAreaInfo}

Transport information:
${transportInfo}

Parking information:
Please contact the host for the latest information.

House rules and booking policies:
Standard check-in/check-out times, cancellation policy, and deposit requirements are shown on the booking page. No specific house rules were supplied beyond what's stated above.`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: FaqRequestBody = await req.json();
    const prompt = buildPrompt(body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let anthropicRes: Response;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 3000,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      console.error('generate-faq-ai: Anthropic API error', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: `Anthropic API error: ${anthropicRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await anthropicRes.json();
    const faq = result?.content?.[0]?.text;
    if (!faq || typeof faq !== 'string') {
      console.error('generate-faq-ai: unexpected Anthropic response shape', JSON.stringify(result).slice(0, 500));
      return new Response(JSON.stringify({ error: 'Unexpected response from Anthropic' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ faq }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-faq-ai unhandled error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
