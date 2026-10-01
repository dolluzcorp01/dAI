/**
 * pm2 for dAI on the Dolluz server.
 *
 * ONE instance, fork mode. Not cluster, and not two.
 *
 * The Docker plan ran two replicas on purpose: two processes behind one port is
 * the smallest arrangement that proves the Redis adapter is actually carrying
 * messages between instances, and one process hides that failure until the day
 * you scale. That reasoning has not changed. What changed is the box: 1 vCPU,
 * 1 GB RAM, already at 75% memory with swap in use and twelve other dApps on
 * it. A second Node process to prove a point is not worth pushing that box into
 * swap and taking the other twelve down.
 *
 * So the adapter is CONFIGURED and UNPROVEN in production. REDIS_URL is set and
 * the adapter attaches, but nothing crosses between instances because there is
 * only one. The day a second instance appears anywhere is the day that becomes
 * load bearing, and it has only ever been proven on a laptop.
 *
 * max_memory_restart is a seatbelt, not a plan. Measured footprint is about
 * 66 MB at rest and 84 MB after bursts of concurrent questions, so 250 MB means
 * something is wrong rather than busy.
 */
module.exports = {
  apps: [
    {
      name: "dai",
      cwd: "/var/www/dolluzcorp.com/dai/server",
      script: "src/server.js",

      // One process. See above before changing this.
      instances: 1,
      exec_mode: "fork",

      // V8 sizes its heap from total system memory, which on a 1 GB box shared
      // with twelve apps is far more than this one should ever take. Cap it.
      //
      // The env file is loaded by node itself, exactly as every npm script in
      // this repo does it. Doing it here rather than exporting from the shell
      // that ran `pm2 start` means a restart days later, or a reboot, gets the
      // same environment as the first start.
      node_args: "--max-old-space-size=256 --env-file-if-exists=/var/www/dolluzcorp.com/dai/.env",

      env: {
        NODE_ENV: "production",
      },

      max_memory_restart: "250M",
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: "30s",

      // pm2 keeps these; pm2-logrotate keeps them from filling a 23 GB disk.
      //   pm2 install pm2-logrotate
      //   pm2 set pm2-logrotate:max_size 20M
      //   pm2 set pm2-logrotate:retain 7
      out_file: "/var/log/dai/out.log",
      error_file: "/var/log/dai/error.log",
      merge_logs: true,
      time: true,

      autorestart: true,
      watch: false,
    },
  ],
};
