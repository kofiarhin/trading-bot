# Docker — paper-trading stack

The web UI and API start without the trading worker.
The worker is deliberately behind the `trading` profile to avoid submitting paper orders by accident.

## Database

The stack uses the **existing MongoDB** from your env file (`MONGO_URI_PROD`, or legacy `MONGO_URI`).
There is no local MongoDB container. Only one worker may run against a database at a time —
stop any other worker (e.g. Heroku) before enabling this one.

## Run

1. Provide an env file with **paper** Alpaca credentials. Never commit it.
   - Default: `./.env`
   - Or point at an existing file: `export TRADING_BOT_ENV_FILE=/path/to/.env`
2. `docker compose build`
3. `docker compose up -d` (web + API only)
4. Open http://localhost:8080 and check http://localhost:8080/api/health.
5. Review broker positions and the journal before enabling any trading.
6. Only after review: `docker compose --profile trading up -d` to enable the 15-minute worker.

The worker aligns its cycles to closed 15-minute candles. Do not add a second cron scheduler.

**Important:** Docker does not create broker-side stop-loss orders. Stops and targets are enforced
only while the worker runs. Verify exit protection before leaving the worker unattended.

The UI is published on `127.0.0.1` only and has no authentication. Do not expose it publicly without
authenticated HTTPS. Production deployment and any trading activation require separate approval.

## Stop

- Worker only: `docker compose stop worker`
- Everything: `docker compose down`
