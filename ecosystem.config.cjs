const projectRoot = process.env.PROJECT_ROOT || __dirname;

const commonAppOptions = {
  max_restarts: 5,
  min_uptime: "10s",
  restart_delay: 5000,
  kill_timeout: 10000
};

module.exports = {
  apps: [
    {
      ...commonAppOptions,
      name: "api-gateway-api",
      cwd: projectRoot,
      script: "npm",
      args: "run start --workspace apps/api",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      ...commonAppOptions,
      name: "api-gateway-web",
      cwd: projectRoot,
      script: "npm",
      args: "run start --workspace apps/web",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
