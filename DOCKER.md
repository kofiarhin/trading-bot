# Docker — local paper-trading stack

The web UI, API and MongoDB start without the trading worker.
The worker is deliberately behind the `trading` profile to avoid submitting paper orders by accident.

1. Copy `.env.example` to `.env` and enter **paper** Alpaca credentials. Never commit `.env`.
2. Run `docker compose build`.
3. Run `docker compose up -d`.
4. Open http://localhost:8080 and check http://localhost:8080/api/health.
5. Review the broker positions and journal before enabling any trading.
6. Only after review, run `docker compose --profile trading up -d` to enable the 15-minute worker.

The worker already aligns its cycles to closed 15-minute candles. Do not add a second cron scheduler.

**Important:** Docker does not create broker-side stop-loss orders. The current bot can have unmanaged Alpaca positions. Resolve those and verify exit protections before leaving the worker unattended.

The example publishes the web UI on localhost only and is **not** a Beast production deployment recipe. On Beast, reuse approved MongoDB/networking and configure authenticated HTTPS access before exposing the UI. Production deployment and any trading activation require separate approval.

To stop the worker without stopping the UI: `docker compose stop worker`.
