import { NavLink, Outlet } from 'react-router-dom'

import { PomodoroTimer } from './PomodoroTimer'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/courses', label: 'Topics' },
  { to: '/wheel', label: 'Koleso' },
  { to: '/import', label: 'Import' },
]

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand-block">
          <p className="kicker">Štátnice DAV 2026</p>
          <h1>Study Companion</h1>
        </div>

        <nav>
          <ul className="nav-list nav-list-header">
            <li className="nav-pomodoro-slot">
              <PomodoroTimer />
            </li>
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="page-wrap">
        <Outlet />
      </main>
    </div>
  )
}
