/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Évite l'avertissement de workspace racine quand plusieurs package-lock.json
  // coexistent (projet bot + site).
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
