import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { AppLayout } from './components/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { CoursesPage } from './pages/CoursesPage'
import { ThemePage } from './pages/ThemePage'
import { WheelPage } from './pages/WheelPage'
import { ImportPage } from './pages/ImportPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'courses',
        element: <CoursesPage />,
      },
      {
        path: 'theme/:themeId',
        element: <ThemePage />,
      },
      {
        path: 'wheel',
        element: <WheelPage />,
      },
      {
        path: 'import',
        element: <ImportPage />,
      },
      {
        path: '*',
        element: <Navigate replace to="/" />,
      },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
