import { ConvexReactClient } from 'convex/react'

const fallbackUrl = 'http://127.0.0.1:3210'

export const convexUrl = import.meta.env.VITE_CONVEX_URL ?? fallbackUrl
export const hasConfiguredConvexUrl = Boolean(import.meta.env.VITE_CONVEX_URL)
export const convex = new ConvexReactClient(convexUrl)
