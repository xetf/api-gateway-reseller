module.exports = {
  apps: [
    {
      name: "api-gateway-api",
      cwd: "/www/wwwroot/api-gateway-reseller",
      script: "npm",
      args: "run start --workspace apps/api",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "api-gateway-web",
      cwd: "/www/wwwroot/api-gateway-reseller",
      script: "npm",
      args: "run start --workspace apps/web",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};