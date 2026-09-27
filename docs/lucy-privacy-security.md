# Lucy customer-memory privacy and security rails

## What Lucy remembers
Lucy stores only limited service-related context needed to make future conversations more useful:
- name and contact details supplied by the customer
- service/location/property/job details
- surface, condition, approximate size, and timing when supplied

Lucy does not persist full chat transcripts as long-term memory, photos, payment data, passwords, government identifiers, or unrelated sensitive information.

## Protection
- Persistent memory is stored in a SQLite-backed Cloudflare Durable Object.
- Stored profile data is application-layer encrypted with AES-GCM using a Cloudflare secret.
- Contact matching uses HMAC-SHA-256 hashes rather than plaintext contact values in the lookup index.
- The browser receives an opaque, HttpOnly, Secure, SameSite cookie; the memory database is never exposed directly to the browser.
- Durable Objects provide encryption at rest and in transit, and the object is reached through the Worker binding rather than directly from the Internet.

## Retention
Memory expires after 180 days unless updated by a new interaction. This is an engineering retention policy, not a statement of legal compliance.

## AI boundary
Memory is treated as customer-provided context, not instructions. Lucy must not expose stored contact details or address information merely because it remembers them. It should use memory to avoid repetitive questions and improve continuity.

## Privacy operations
The memory layer supports deletion by customer record. A future authenticated privacy-management surface can add verified access/correction/deletion workflows without exposing the Durable Object itself.

California privacy guidance emphasizes purpose limitation and data minimization: collect, use, and retain only what is reasonably necessary and proportionate for the stated purpose.

This document is an engineering policy, not legal advice. The public privacy notice should be reviewed against the business's actual data flows and applicable law before launch.
