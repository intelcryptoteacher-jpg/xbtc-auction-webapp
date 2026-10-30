import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TROY_OUNCES_PER_KG = 1000 / 31.1034768;
const FXAPI_URL = "https://api.fxapi.com/v1/latest";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const enabled = Deno.env.get("XBTC_PRICE_FEED_ENABLED") === "true";
  const apiKey = Deno.env.get("FXAPI_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!enabled) return json({ status: "disabled", message: "Feed disabled pending API key configuration and written commercial redistribution approval." }, 503);
  if (!apiKey || !supabaseUrl || !serviceKey) return json({ status: "not_configured", message: "Required server-side secrets are missing." }, 503);
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${serviceKey}`) return json({ error: "Service role authorization required" }, 401);

  try {
    // One EUR-base response supplies both metals with one shared provider timestamp.
    // No BTC market or fallback source is queried.
    const upstream = await fetch(`${FXAPI_URL}?base_currency=EUR&currencies=XAU,XAG`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) return json({ error: "fxapi request failed", upstream_status: upstream.status }, 502);
    const payload = await upstream.json();
    const observedAt = payload?.meta?.last_updated_at;
    const timestamp = new Date(observedAt);
    const goldPerEur = Number(payload?.data?.XAU?.value);
    const silverPerEur = Number(payload?.data?.XAG?.value);
    if (!observedAt || !Number.isFinite(timestamp.getTime()) ||
        !Number.isFinite(goldPerEur) || goldPerEur <= 0 ||
        !Number.isFinite(silverPerEur) || silverPerEur <= 0) {
      return json({ error: "Both XAU and XAG quotes and a valid timestamp are required." }, 502);
    }
    const ageMs = Date.now() - timestamp.getTime();
    if (ageMs < -60000 || ageMs > 36 * 60 * 60 * 1000) {
      return json({ error: "Quote timestamp is in the future or stale.", observed_at: observedAt }, 502);
    }

    const receivedAt = new Date().toISOString();
    const raw = [
      { metal: "gold", eurPerTroyOunce: 1 / goldPerEur },
      { metal: "silver", eurPerTroyOunce: 1 / silverPerEur },
    ];
    const rows = await Promise.all(raw.map(async (item) => ({
      metal: item.metal,
      price_eur_per_kg: (item.eurPerTroyOunce * TROY_OUNCES_PER_KG).toFixed(8),
      source_name: "fxapi",
      source_benchmark: "fxapi_mid_market_XAU_XAG_EUR_per_troy_ounce",
      source_observation_id: `${item.metal}:${observedAt}`,
      source_currency: "EUR",
      source_unit: "EUR_per_kg",
      observed_at: observedAt,
      received_at: receivedAt,
      source_payload_hash: await sha256(JSON.stringify({ metal: item.metal, payload })),
      quote_type: "mid_market_reference",
      licensing_status: "pending",
      is_validated: false,
      validation_notes: "Pending written commercial redistribution approval and administrator validation.",
    })));

    const storedResponse = await fetch(
      `${supabaseUrl}/rest/v1/xbtc_metal_price_observations?on_conflict=source_name,source_benchmark,source_observation_id,metal`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      },
    );
    if (!storedResponse.ok) return json({ error: "Could not store raw observations", detail: (await storedResponse.text()).slice(0, 400) }, 502);
    const stored = await storedResponse.json();
    return json({
      status: "observations_imported_pending_review",
      provider: "fxapi",
      quote_type: "mid_market_reference_not_executable",
      observed_at: observedAt,
      received_at: receivedAt,
      unit: "EUR_per_kg",
      returned_observations: Array.isArray(stored) ? stored.length : 0,
      index_calculation: "not_run",
      xbtc_eur_publication: "blocked_until_anchor_approval_and_commercial_rights_confirmation",
    });
  } catch (error) {
    return json({ error: "Price-feed processing failed", detail: String(error).slice(0, 250) }, 500);
  }
});