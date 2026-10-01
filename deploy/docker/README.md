# Not how dAI runs

Production is pm2 behind nginx on the shared Dolluz server. See
`deploy/deploy.sh`, `ecosystem.config.js` and `deploy/nginx/`.

This compose file is kept for one reason: it holds the two-replica reasoning.
Two processes behind one port is the smallest arrangement that proves the Redis
adapter is carrying messages between instances, and one process hides that
failure until the day you scale. The pilot runs one process on a 1 GB box, so
the adapter is configured and unproven there, and this file is what to come
back to when there is somewhere to prove it.

The Dockerfile at the repository root is still current. It builds, runs as a
non-root user and passes its own healthcheck, and it is what CI would use.

There was a Caddyfile here. It was deleted rather than kept: Caddy would
collide with nginx on 80 and 443, so it could never run on this server, and a
config file that cannot run is a thing someone will one day try to use.
