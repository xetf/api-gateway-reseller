const projectRoot = process.env.PROJECT_ROOT || __dirname;

module.exports = {
  apps: [
    {
      name: "api-gateway-api",
      cwd: projectRoot,
      script: "npm",
      args: "run start --workspace apps/api",
      env: {
        NODE_ENV: "production"
      }
    },
    {
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
