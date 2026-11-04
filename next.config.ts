import type { NextConfig } from 'next'

// Static export: the whole experience is client-rendered WebGL over static HTML, deployable to any static host.
// A host that serves the site from a sub-path (GitHub Pages project sites) sets NEXT_PUBLIC_BASE_PATH, e.g. /Aigrowsi.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
}

export default nextConfig
