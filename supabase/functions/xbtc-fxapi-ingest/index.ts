import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const enabled = Deno.env.get("XBTC_PRICE_FEED_ENABLED") === "true";
  const apiKey = Deno.env.get("METALCHARTS_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!enabled) return json({ status: "disabled", provider: "MetalCharts" }, 503);
  if (!apiKey || !url || !serviceKey) return json({ status: "not_configured" }, 503);
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

  try {
    const response = await fetch("https://api.metalcharts.org/v1/prices/?symbols=XAU,XAG&currency=EUR&unit=kg", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return json({ error: "MetalCharts request failed", upstream_status: response.status }, 502);
    const payload = await response.json();
    if (payload?.success !== true) return json({ error: "Unexpected MetalCharts response" }, 502);
    const receivedAt = new Date().toISOString();
    const items = ["XAU", "XAG"].map((symbol) => {
      const q = payload?.data?.[symbol];
      const price = Number(q?.price);
      const date = new Date(q?.timestamp ?? payload?.timestamp);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(date.getTime())) throw new Error(`Invalid ${symbol} quote or timestamp`);
      const age = Date.now() - date.getTime();
      if (q?.stale === true || age < -60000 || age > 36 * 60 * 60 * 1000) throw new Error(`Stale ${symbol} quote`);
      return { symbol, metal: symbol === "XAU" ? "gold" : "silver", price, observedAt: date.toISOString(), quote: q };
    });
    if (Math.abs(Date.parse(items[0].observedAt) - Date.parse(items[1].observedAt)) > 5 * 60 * 1000) return json({ error: "Gold and silver timestamps differ by more than five minutes" }, 502);
    const rows = await Promise.all(items.map(async (item) => ({
      metal: item.metal,
      price_eur_per_kg: item.price.toFixed(8),
      source_name: "MetalCharts",
      source_benchmark: "MetalCharts_SPOT_EUR_per_kg",
      source_observation_id: `${item.symbol}:${item.observedAt}`,
      source_currency: "EUR",
      source_unit: "EUR_per_kg",
      observed_at: item.observedAt,
      received_at: receivedAt,
      source_payload_hash: await sha256(JSON.stringify(item.quote)),
      quote_type: "mid_market_reference",
      licensing_status: "pending",
      is_validated: false,
      validation_notes: "Commercial use permitted by published MetalCharts terms; public display attribution required on free tier. Pending operator validation.",
    })));
    const storedResponse = await fetch(`${url}/rest/v1/xbtc_metal_price_observations?on_conflict=source_name,source_benchmark,source_observation_id,metal`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(rows),
    });
    if (!storedResponse.ok) return json({ error: "Database insert failed", detail: (await storedResponse.text()).slice(0, 300) }, 502);
    const stored = await storedResponse.json();
    return json({ status: "observations_imported_pending_review", provider: "MetalCharts", observed_at: { gold: items[0].observedAt, silver: items[1].observedAt }, unit: "EUR_per_kg", inserted_count: Array.isArray(stored) ? stored.length : 0, index_calculation: "not_run", xbtc_publication: "blocked_pending_admin_activation", attribution_required: true });
  } catch (error) {
    return json({ error: "Price-feed validation failed", detail: String(error).slice(0, 200) }, 502);
  }
});