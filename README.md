# dmarc-email-worker

A Cloudflare worker script to process incoming DMARC reports, store them, and produce analytics.

It makes use of:

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [R2](https://developers.cloudflare.com/r2/)
- [Worker Analytics](https://developers.cloudflare.com/workers/analytics/)

More details on the [blog post](https://blog.cloudflare.com/how-we-built-dmarc-management/).

## Install instructions

1. Clone this repo
1. Install dependencies with `npm install`
1. Login to your Cloudflare account with `npx wrangler login`
1. Ensure that the names of the R2 buckets used and Worker Analytics dataset are correct in `wrangler.toml`
1. Run `npx wrangler publish` to publish the worker
1. Configure an Email Routing rule to forward the email from a destinattion address to this worker `dmarc-email-worker`
1. Add this address as RUA to your domain's DMARC record

## Inspecting the data

After obtaining the `account_id` and `token` from the [API Tokens](https://dash.cloudflare.com/profile/api-tokens) page, you can run the following query to get the DMARC reports:

```bash
curl -X POST 'https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql' \
-H 'Authorization: Bearer <token>' \
-d 'SELECT
    timestamp,
    blob1 AS reportMetadataReportId,
    blob2 AS reportMetadataOrgName,
    toDateTime(double1) AS reportMetadataDateRangeBegin,
    toDateTime(double2) AS reportMetadataDateRangeEnd,
    blob3 AS reportMetadataError,
    blob4 AS policyPublishedDomain,
    double3 AS policyPublishedADKIM,
    double4 AS policyPublishedASPF,
    double5 AS policyPublishedP,
    double6 AS policyPublishedSP,
    double7 AS policyPublishedPct,
    blob5 AS recordRowSourceIP,
    toUInt32(double8) AS recordRowCount,
    double9 AS recordRowPolicyEvaluatedDKIM,
    double10 AS recordRowPolicyEvaluatedSPF,
    double11 AS recordRowPolicyEvaluatedDisposition,
    double12 AS recordRowPolicyEvaluatedReasonType,
    blob6 AS recordIdentifiersEnvelopeTo,
    blob7 AS recordIdentifiersHeaderFrom
FROM dmarc_reports
WHERE timestamp > NOW() - INTERVAL '\''24'\'' DAY'
```
