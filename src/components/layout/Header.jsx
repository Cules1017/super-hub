import { Link, NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useConfig } from '../../hooks/useConfig.jsx';
import { useTheme } from '../../hooks/useTheme.jsx';

const nav = [
  { to: '/', label: 'Trang chủ' },
  { to: '/sport', label: 'Sport Hub' },
];

export default function Header() {
  const { get, lastUpdated } = useConfig();
  const { theme, toggle } = useTheme();
  const siteName = get('site_name', 'Mega Hub');
  const tagline = get('site_tagline', '');

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="sticky top-0 z-40 border-b backdrop-blur-xl"
      style={{ borderColor: 'var(--border-color)', background: 'var(--glass-strong-bg)' }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 font-black text-slate-900 shadow-glow">
            M
          </div>
          <div>
            <div className="text-base font-bold tracking-tight">{siteName}</div>
            {tagline && (
              <div className="hidden text-[11px] text-slate-400 sm:block">{tagline}</div>
            )}
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 text-[11px] text-slate-400 md:flex">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Live · {lastUpdated ? new Date(lastUpdated).toLocaleTimeString('vi-VN') : '—'}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            title={theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối'}
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:brightness-110"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--border-color)' }}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </motion.header>
  );
}
