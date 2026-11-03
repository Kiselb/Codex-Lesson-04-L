function tursoConfig(env = process.env) {
  return {
    url: env.KISELB_TURSO_DATABASE_URL || env.TURSO_DATABASE_URL,
    authToken: env.KISELB_TURSO_AUTH_TOKEN || env.TURSO_AUTH_TOKEN,
  };
}

module.exports = { tursoConfig };
