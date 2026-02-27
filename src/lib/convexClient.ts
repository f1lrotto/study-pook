import { ConvexReactClient } from 'convex/react'

const localDevFallbackUrl = 'http://127.0.0.1:3210'
const envConvexUrl = import.meta.env.VITE_CONVEX_URL?.trim()
const isDev = import.meta.env.DEV

export const convexUrl = envConvexUrl || (isDev ? localDevFallbackUrl : null)
export const hasConfiguredConvexUrl = Boolean(envConvexUrl)
export const isConvexEnvMissingInProd = import.meta.env.PROD && !envConvexUrl

if (isConvexEnvMissingInProd) {
  // Surface misconfiguration quickly in production builds.
  console.error('Missing VITE_CONVEX_URL in production build.')
}

export const convex = new ConvexReactClient(convexUrl ?? 'https://invalid-convex-url.local')
