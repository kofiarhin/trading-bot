# Beast deployment preparation (not activated)

This deployment is intentionally **dry-run only**. The Compose command uses `autopilot:dry`; do not change it without a separate approval and trading safety review.

## Preconditions
- Confirm the Beast project workspace is registered and mapped to `kofiarhin/trading-bot`; the path in the unit is a **proposed** path, not a verified live path.
- Check live VPS capacity, Docker access, and existing scheduled jobs.
- Supply a private `.env` on Beast with Alpaca **paper** credentials, `MONGO_URI` and `MONGO_DB_NAME`. Never commit it.
- Ensure the MongoDB host is reachable from a Docker bridge container. `localhost` inside the container does not refer to the VPS.
- Check the current Alpaca account state and any other bot instances before enabling the timer.

## Preparation
```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps trading-bot
```

These commands are for a separately approved Beast operator session, not steps already executed.

After confirming a successful dry-run, separately approve installation of the service and timer under `/etc/systemd/system`, then `systemctl daemon-reload` and `systemctl enable --now trading-bot.timer`. Installing/enabling the timer is a production change and requires explicit approval. The timer triggers on UTC quarter-hour boundaries plus 30 seconds. A oneshot service will not start a second copy while the previous invocation is still active.

Review logs with `journalctl -u trading-bot.service` and confirm MongoDB cycle records. Avoid logging credentials. The unit requires Docker permissions (normally root when run by systemd); never expose the Docker socket to the container.

**Not included:** live/paper order placement activation, public API, dashboard hosting, firewall, Nginx, or MongoDB provisioning.
