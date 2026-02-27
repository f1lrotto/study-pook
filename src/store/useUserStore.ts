import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const defaultUserKey = 'study-user-main'

type UserStore = {
  userKey: string
  setUserKey: (userKey: string) => void
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      userKey: defaultUserKey,
      setUserKey: (userKey) => set({ userKey }),
    }),
    {
      name: 'study-companion-user',
    },
  ),
)
