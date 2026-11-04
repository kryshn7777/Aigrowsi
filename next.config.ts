import type { NextConfig } from 'next'

// Static export: the whole experience is client-rendered WebGL over static HTML, deployable to any static host.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
}

export default nextConfig
