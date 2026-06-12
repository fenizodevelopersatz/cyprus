module.exports = {
  apps: [
    {
      name: "exchange-backend",
      script: "./dist/main.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      env: {
        NODE_ENV: "development",
        PORT: 4500,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 4500,
      },
    },
  ],
};
