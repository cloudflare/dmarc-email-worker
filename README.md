# dmarc-email-worker

A Cloudflare worker script to process incoming DMARC reports, store them, and produce analytics.

It makes use of:

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [R2](https://developers.cloudflare.com/r2/)
- [Worker Analytics](https://developers.cloudflare.com/workers/analytics/)

More details on the [blog post](https://blog.cloudflare.com/how-we-built-dmarc-management/).
