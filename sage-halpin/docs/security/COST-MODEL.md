# Cost model (Azure, UK South)

## Read this first

- **The prices below are unverified estimates.** The Azure Retail Prices API
  (`prices.azure.com`) and the azure.microsoft.com pricing pages are blocked
  by this environment's network proxy. The only figure confirmed in this
  review is the Front Door Premium base fee (US$330 a month), from a search
  of Microsoft's pricing page on 7 October 2026. The rest are pay-as-you-go
  list prices in **USD**, from public sources and earlier list prices. UK
  South is usually 0–15% above US East. **Before committing, re-price every
  line** in the Azure Pricing Calculator (region UK South, currency GBP, the
  customer's agreement type) and record the date.
- **No budget ceiling has been approved.** Under the directive, paid
  infrastructure is not committed until the customer states one. The Bicep
  `budgetAmount` parameter has no default, so a deployment cannot run
  without it.
- **No reservations or savings plans.** Pay-as-you-go only, until usage is known.
- **AI usage is billed separately.** It goes to Anthropic or to Azure Foundry,
  and is the most variable line. It is capped by `AI_DAILY_CALL_LIMIT` and
  by the provider-side spend limit.

## Traffic assumptions (to be confirmed)

Under 50 organisations; under 500 sign-ins a day; about 200k requests a
month; under 20 GB a month out through Front Door; database under 10 GB;
logs 5–15 GB a month per environment.

## Itemised monthly estimate (USD, pay-as-you-go, unverified apart from the starred line)

| Item | Minimum (one environment, no HA) | Recommended prod | Nonprod (alongside prod) | Notes |
| --- | --- | --- | --- | --- |
| Front Door Premium base * | 330 | 330 | 330, or 35 with Alternative A | Separate profiles keep prod and nonprod apart. Nonprod may use Standard (no Private Link). The Premium base fee is fixed |
| Front Door requests and data out | 5 | 5–15 | 2 | About 0.01 per 10k requests; 0.08–0.11 per GB out (Zone 1) |
| WAF policy (Premium managed rules) | 0 | 0 | 0 | Included in the Premium base fee |
| App Service Linux P0v3 | 62 (× 1) | 186 (× 3, zone-redundant) | 62 | Zone redundancy needs at least 3 instances. P1v3 is about 2× P0v3 per instance |
| PostgreSQL Flexible: compute | 13 (B1ms) | 260 (D2ds_v5 + zone-redundant HA standby) | 13 | HA doubles compute |
| PostgreSQL storage and backup | 4 (32 GB) | 30 (128 GB × 2 for HA, plus geo-backup) | 4 | About 0.115 per GB-month. Backup up to 100% of provisioned storage is free |
| Private endpoints | 22 (3 × ~7.30) | 30 (4) | 22 | Plus about 0.01 per GB processed |
| Private DNS zones | 2 | 2 | 2 | 0.50 per zone |
| Container Registry | 5 (Basic) | 50 (Premium, private) | 5 | Prod could pull from a Basic registry over a public endpoint with managed identity to save about 45 (a deviation; recorded in ADR if chosen) |
| Key Vault | 1 | 1 | 1 | Per operation |
| Storage (uploads) | 1 | 2 | 1 | GRS in prod |
| Log Analytics + App Insights | 0–15 | 15–40 | 0–15 | 2.30–2.80 per GB after the free allowance. Use a daily cap in nonprod |
| Defender for Cloud | 0 (optional) | 45–60 | 0–20 | App Service about 15 per instance; open-source DB about 15 per server; Key Vault per transaction; Storage about 10 per account |
| Alerts and action groups | 1 | 3 | 1 | About 0.10 per metric alert rule |
| NAT gateway (outbound to the AI provider and email) | 33 | 33 | 33 | About 0.045 per hour plus 0.045 per GB. Added by the Bicep, because the integration subnet has no default outbound access (deviation recorded in `infra/azure/README.md`) |
| **Subtotal** | **about 480–515** | **about 995–1,035** | **about 175–515** | |

**Expected monthly spend for the recommended setup (prod and a lean
nonprod):** about $1,170–1,300, plus AI usage. **Peak** (prod manually scaled to 6
× P0v3 under load, logs doubled): about $1,500, plus AI usage.

**Bounded scaling.** No autoscale: prod runs a fixed 3 instances (the `capacity`
parameter), and scaling out is a reviewed change through the pipeline. The
database tier does not autoscale either. Front Door and logs scale with traffic,
and the budget alerts at 50/80/100% catch it.

## Configurations

| Configuration | What it is | About (USD per month) | What you give up |
| --- | --- | --- | --- |
| **Minimum** | One environment, P0v3 × 1, B1ms with no HA, Front Door Premium, private endpoints | 480–515 | No zone redundancy, so 99.9% is unlikely. RPO from PITR is fine. No nonprod |
| **Recommended** | ADR-001 as written: prod zone-redundant, HA PostgreSQL, Defender, plus a lean nonprod | 1,170–1,300 | — |
| **Alternative A** (only if Recommended exceeds the ceiling) | Front Door **Standard** (35); origin public but locked to the AzureFrontDoor.Backend tag and `X-Azure-FDID`; WAF custom rules only (no managed OWASP rule set) | Recommended minus about 295 | Origin addressable from the Internet. No managed OWASP or bot rules. This weakens the approved design, so it needs a written decision |
| **Optional** | Cross-region read replica for a 15-minute RPO on region loss | +130–290 | — |
| **Optional** | DDoS Network Protection | about +2,944 | Not recommended without a DDoS risk assessment |
| **Optional** | Azure Firewall (Standard) for an egress allow-list | about +900 | — |

## Decision needed from the customer

State the monthly ceiling, for example "US$1,400 a month excluding AI,
reviewed after 3 months". It goes into `budgetAmount` and into the ADR. If
the ceiling is below about $1,100, choose either Minimum (and accept the
availability gap) or Alternative A (and accept the weaker edge), in writing.
