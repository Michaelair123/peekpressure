# Lucy Competitive Pricing

Lucy performs an internal competitive-pricing review using public web information. The review is advisory only: it never changes PEEK PRESSURE pricing automatically.

## One-time setup

Add the same random secret value in both places.

### Cloudflare Pages

Add an environment secret named `COMPETITIVE_REVIEW_TOKEN`.

### GitHub repository

Add an Actions secret named `PEEK_COMPETITIVE_REVIEW_TOKEN`.

The two values must match.

## What happens

Every Friday, the GitHub Action calls `POST /api/competitive-review`.

Lucy researches public Bay Area competitor pricing and creates a GitHub issue containing published competitor observations, source URLs, proposed PEEK PRESSURE pricing, confidence, rationale, and guardrails.

The workflow does not modify customer-facing pricing.

## Approval

Review the issue. If you approve a proposal, update `competitive-pricing.json` with the approved values and commit the change. That file is intentionally separate from research so an unapproved suggestion cannot silently become a customer price.

## Manual run

GitHub Actions also supports Run workflow so you can trigger a review whenever you want.

## Research rules

Lucy uses public information only. She does not submit competitor forms, create accounts, bypass access controls, or use private information. Direct local competitor pricing receives more weight than generic national cost calculators.
