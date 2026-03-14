import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { isConvexEnvMissingInProd } from '../lib/convexClient'
import { PomodoroTimer } from './PomodoroTimer'

const navItems = [
  { to: '/', label: 'Prehľad' },
  { to: '/courses', label: 'Témy' },
  { to: '/wheel', label: 'Koleso' },
]

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Close menu on navigation
  const handleNavClick = () => setMenuOpen(false)

  return (
    <div className="app-shell">
      {isConvexEnvMissingInProd ? (
        <article className="panel error">
          Chýba <code>VITE_CONVEX_URL</code> v produkčnom builde. Nastav ju v Netlify a sprav
          <strong> Clear cache and deploy site</strong>.
        </article>
      ) : null}

      <header className="top-nav">
        <div className="brand-block">
          <p className="kicker">Štátnice DAV 2026</p>
          <h1>Study Companion</h1>
        </div>

        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Zavrieť menu' : 'Otvoriť menu'}
          aria-expanded={menuOpen}
        >
          <span className={`hamburger-icon ${menuOpen ? 'hamburger-open' : ''}`} />
        </button>

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

        {menuOpen && (
          <div className="mobile-menu-overlay" onClick={handleNavClick}>
            <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="mobile-menu-nav">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    className={({ isActive }) =>
                      `mobile-menu-link ${isActive ? 'mobile-menu-link-active' : ''}`
                    }
                    to={item.to}
                    onClick={handleNavClick}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
              <div className="mobile-menu-pomodoro">
                <PomodoroTimer />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="page-wrap">
        <Outlet />
      </main>
    </div>
  )
}
