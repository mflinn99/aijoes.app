# Hosting and operations provider obligations (draft for signature)

A draft for the customer and whoever operates Sentinel8 for them (the
"Provider"). **It is not legal advice.** It needs review by the customer's
legal adviser before signature. Nothing here is agreed until it is signed.

## 1. Ownership and access

1.1 The customer owns, and is the account holder of, the Entra tenant, the Azure subscription, the source repository, the domains and DNS, the AI provider accounts and all data. The Provider holds no account the customer cannot see, suspend or remove.

1.2 The Provider's people get named accounts with phishing-resistant MFA and just-in-time (PIM) elevation. There are no shared credentials.

1.3 On termination, or within 5 working days of a request, the Provider hands back all access, credentials, documentation and data exports, confirms in writing that it has deleted its own copies, and removes its accounts.

## 2. Security

2.1 The Provider maintains the controls in `ASVS-L2-MATRIX.md`, `IDENTITY.md` and `PIPELINE.md`, and does not weaken an approved control without the customer's written approval.

2.2 Patching: critical and high vulnerabilities in production dependencies or images are fixed within 7 days and 30 days respectively of a fix being available. If no fix exists, the Provider puts a compensating control in place.

2.3 The Provider keeps logs 90 days hot and 1 year archived, keeps them free of secrets and of personal data beyond what the logs need, and gives the customer access.

2.4 The Provider tells the customer about any suspected security incident affecting the customer's data **without undue delay, and within 24 hours of becoming aware of it**, so the customer can meet its 72-hour obligations under UK GDPR. The notice says what is known, and the Provider follows `RECOVERY.md#compromise`.

2.5 The Provider permits an independent penetration test at least once a year and after significant changes, and fixes the findings within the patching windows in 2.2.

## 3. Availability and recovery

3.1 Targets (not guarantees): 99.9% monthly availability, RPO 15 minutes, RTO 4 hours. Region loss: RPO 1 hour.

3.2 Restore drills every quarter (`RECOVERY.md`), with results reported to the customer.

3.3 Monitoring and alerting as in `MONITORING.md`. Each alert has a named owner and a runbook.

## 4. Data protection

4.1 The Provider acts as a processor under the customer's instructions, with a UK GDPR Article 28 data-processing agreement attached.

4.2 Data stays in UK South (with geo-backup in UK West) unless the customer agrees otherwise in writing. The AI provider and its processing location are listed as sub-processors.

4.3 The Provider gives 30 days' notice before adding a sub-processor.

## 5. Cost

5.1 The Provider does not commit the customer to spend above the approved budget ceiling, or to reservations or savings plans, without written approval.

5.2 The Provider reports spend against budget monthly.

## 6. Change

6.1 Production changes go through the pipeline, with approval in the `production` environment. Emergency changes are documented within 1 working day.

## Open items before signature

- The customer's legal entity and signatory.
- The Provider's identity. Today the work has been done by Claude sessions directed by the repository owner. An AI assistant cannot be a party to this agreement. A named person or company must take on these obligations.
- Service credits, liability caps, and governing law.
