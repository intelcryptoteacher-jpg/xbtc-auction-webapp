# XBTC gold/silver reference index

The server-side ingestion function is at `supabase/functions/xbtc-fxapi-ingest/index.ts`.

## Status

- **Provider:** fxapi (Everapi GmbH).
- **Inputs:** XAU and XAG quoted against EUR, converted to EUR per kilogram.
- **Reference:** mid-market, **not** an executable trading price or physical-metal backing.
- **Index weights:** 50% gold and 50% silver, normalized to approved baseline observations.
- **Initial anchor:** pending approval. Proposed €1.00306 per gram is **not** an approved EUR/XBTC rate.
- **Commercial redistribution rights:** pending written confirmation.
- **Price feed:** disabled until separately enabled by an authorized operator.
- **No BTC fallback:** a missing, invalid, or stale metal quote rejects ingestion.

## Server-only configuration

Set `FXAPI_KEY` in Supabase Dashboard → Edge Functions → Secrets. Never add it to source files, the browser, GitHub Actions logs, or `.env` committed to Git.

Set `XBTC_PRICE_FEED_ENABLED=false` while licensing and approvals are pending. This variable must be explicitly set to `true` to permit ingestion. Supabase service-role credentials are accessed only inside the Edge Function.

## Storage and calculation

Observations go to `public.xbtc_metal_price_observations` with provider, timestamp, EUR/kg conversion, quote type, source hash, and pending licensing/validation status. The index snapshot function `public.calculate_xbtc_index_snapshot(uuid,uuid)` stores gold/silver normalized indices, the 50/50 combined index, and calculation version `xbtc-metal-index-v1`. Its database migration and access controls are already deployed in Supabase; they are not represented by this source file alone.

The index calculation requires an active configuration, approved source rights, validated observations, approved baseline observations, and an approved EUR-per-XBTC anchor. The public-facing rate must not be published until these conditions are met.

## Deployment

The Edge Function has been deployed separately in Supabase. This GitHub copy is source control only; GitHub Pages cannot execute Deno Edge Functions. No API key, secret values, or live price data are included here. This repository change does not turn on the feed or activate the index.
