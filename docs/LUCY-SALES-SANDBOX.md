# Lucy Sales Sandbox

Lucy is allowed to improve **sales technique**, not PEEK PRESSURE's business rules.

## What the sandbox can experiment with
- conversation wording
- question order
- low-friction contact capture
- buying-signal handling
- objection handling
- commercial/property-manager flow
- delegated site-review flow
- concise closes
- reducing repetitive questions

## What remains under human control
The business owner controls:
- pricing and minimums
- discounts
- approved services
- service area
- booking policy
- refunds
- payment rules
- credentials and insurance claims
- legal/compliance claims
- customer-facing commitments
- production deployment

An experiment may change **how Lucy sells**, never **what PEEK PRESSURE is authorized to sell or promise**.

## How the sandbox works
1. Lucy's current behavior is the baseline.
2. Experimental strategies run only against the staging endpoint.
3. Each strategy is tested against sales and hard-guardrail scenarios.
4. A report is produced as `lucy-sales-lab-report.json`.
5. The lab may identify a candidate for human review.
6. **Nothing is automatically promoted to production.**

The GitHub Actions workflow is manual: `.github/workflows/lucy-sales-sandbox.yml`.

This is intentional. Lucy can explore and learn inside the sandbox while the business owner retains final authority.
