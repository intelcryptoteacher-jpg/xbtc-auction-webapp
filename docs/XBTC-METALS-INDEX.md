# XBTC gold/silver reference index

The server-side ingestion function is at `supabase/functions/xbtc-fxapi-ingest/index.ts` (function slug retained for compatibility; provider is MetalCharts).

## Status

- **Provider:** MetalCharts.
- **Plan:** Free tier, 200 request-weight units per month and 10 per minute.
- **Inputs:** XAU and XAG spot quotes in EUR per kilogram.
- **Reference:** spot reference, not an executable trading price or physical-metal backing.
- **Index weights:** 50% gold and 50% silver, normalized to approved baseline observations.
- **Anchor:** configured in Supabase as €1.00306 per XBTC. The user confirmed that one XBTC represents the index value of one gram of the 50/50 basket. This is not a published conversion rate.
- **Commercial use:** MetalCharts' published terms permit commercial use on the free plan. Public displays must include a visible link to https://metalcharts.org. Reselling API access or republishing raw data as a competing feed is prohibited.
- **Price feed:** disabled until server secrets are configured and an authorized operator deliberately enables it.
- **No BTC fallback:** missing, invalid, stale, or materially mismatched metal timestamps reject ingestion.

## Server-only configuration

Set `METALCHARTS_API_KEY` in Supabase Dashboard → Edge Functions → Secrets. Never add it to source files, browser code, GitHub Actions logs, or committed `.env` files.

Keep `XBTC_PRICE_FEED_ENABLED=false` while credentials and operational checks are pending. Set it to `true` only after operator approval. Supabase service-role credentials are accessed only inside the Edge Function.

## Storage and calculation

Observations go to `public.xbtc_metal_price_observations` with provider, timestamp, EUR/kg price, quote type, source hash, and pending licensing/validation status. The index snapshot function `public.calculate_xbtc_index_snapshot(uuid,uuid)` stores normalized gold/silver indices, the 50/50 combined index, and calculation version `xbtc-metal-index-v1`.

The index calculation requires an active configuration, approved source rights, validated observations, approved baseline observations, and an approved EUR-per-XBTC anchor. The public-facing rate must not be published until these conditions are met.

## Attribution and limits

Free tier: 200 request-weight units per month, 10 per minute, no payment card required. Spot price requests cost one weight. Public price displays require a visible attribution link such as "Metal prices by MetalCharts". The provider prohibits reselling API access or redistributing raw data as a competing feed.

## Deployment

The Edge Function is deployed separately in Supabase. GitHub Pages cannot execute Deno Edge Functions. No API key, secret values, or live price data are included here. This source update does not turn on the feed or activate the index.
