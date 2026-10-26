/** @type {import('next').NextConfig} */
const nextConfig = {
  // native / heavy server-only packages are loaded from node_modules at runtime instead of being bundled
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp', 'pg', 'mongodb'],
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
