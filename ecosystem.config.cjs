module.exports = {
  apps: [
    {
      name: "api-gateway-api",
      cwd: "/www/wwwroot/api-gateway-reseller",
      script: "npm",
      args: "run dev:api",
      env: {
        NODE_ENV: "development"
      }
    },
    {
      name: "api-gateway-web",
      cwd: "/www/wwwroot/api-gateway-reseller",
      script: "npm",
      args: "run dev:web",
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};