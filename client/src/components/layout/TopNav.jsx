/**
 * TopNav — h-14 (56px) fixed top bar.
 * Contains: hamburger (mobile), brand, search, user email, org_name, role badge, logout.
 * CSS vars only — no hardcoded Tailwind colour classes.
 */
import { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import useAuthStore from '../../stores/authStore';

export default function TopNav({ onMenuClick }) {
  const getIcon = useIcon();
  const { user, logout } = useAuthStore();
  const [searchValue, setSearchValue] = useState('');

  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const isAdmin = primaryRole === 'org_admin';

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 gap-4"
      style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Mobile hamburger */}
      <button
        className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:opacity-70 transition-all"
        onClick={onMenuClick}
        aria-label="Toggle menu"
        style={{ color: 'var(--color-text)' }}
      >
        {getIcon('menu', { size: 18 })}
      </button>

      {/* Brand */}
      <span
        className="font-semibold text-sm shrink-0"
        style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}
      >
        MCP CuramTools
      </span>

      {/* Search — centred */}
      <div className="flex-1 flex justify-center">
        <div
          className="relative hidden md:flex items-center w-full max-w-xs"
        >
          <span
            className="absolute left-2.5"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('search', { size: 14 })}
          </span>
          <input
            type="text"
            placeholder="Search…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-sm outline-none"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Org name */}
        {user?.orgName && (
          <span className="hidden md:block text-xs" style={{ color: 'var(--color-muted)' }}>
            {user.orgName}
          </span>
        )}

        {/* User email */}
        <span className="hidden md:block text-sm" style={{ color: 'var(--color-text)' }}>
          {user?.email}
        </span>

        {/* Role badge */}
        {primaryRole && (
          <span
            className="text-xs rounded-full px-2 py-0.5 font-medium"
            style={
              isAdmin
                ? { background: '#fef3c7', color: '#92400e' }
                : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
            }
          >
            {isAdmin ? 'Admin' : 'Member'}
          </span>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:opacity-70 transition-all"
          aria-label="Log out"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('logout', { size: 16 })}
        </button>
      </div>
    </header>
  );
}
