/**
 * Sidebar — 220px expanded / 56px collapsed.
 * Desktop: fixed, top: 56px to bottom.
 * Mobile: overlay with backdrop.
 * Labelled sections: Tools, Admin.
 * Collapse state persists to toolStore.
 */
import { useEffect } from 'react';
import { useIcon } from '../../providers/IconProvider';
import NavItem from './NavItem';
import useToolStore from '../../stores/toolStore';
import useAuthStore from '../../stores/authStore';

export default function Sidebar({ mobileOpen, onClose }) {
  const getIcon = useIcon();
  const { sidebarCollapsed, toggleSidebar } = useToolStore();
  const { user } = useAuthStore();

  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const isAdmin = primaryRole === 'org_admin';
  const isMonitoringPath = (path) => (
    path === '/admin/monitoring'
    || path.startsWith('/admin/monitoring/')
    || ['/admin/operations', '/admin/diagnostics', '/admin/usage', '/admin/logs', '/admin/agent-trust', '/admin/claude-sessions'].includes(path)
  );
  const isAdminPath = (path) => path === '/admin' || (path.startsWith('/admin/') && !isMonitoringPath(path));

  // Close mobile sidebar on keyboard Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const sidebarWidth = sidebarCollapsed ? 56 : 220;

  const SidebarContent = ({ collapsed, onLinkClick }) => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable nav area */}
      <div className="flex-1 overflow-y-auto">
        {/* Primary navigation */}
        <div className="pt-3">
          <NavItem
            to="/dashboard"
            icon="dashboard"
            label="Home"
            collapsed={collapsed}
            onClick={onLinkClick}
            activeWhen={(path) => path === '/dashboard'}
          />
          <NavItem
            to="/tools"
            icon="layers"
            label="Tools"
            collapsed={collapsed}
            onClick={onLinkClick}
            activeWhen={(path) => path === '/tools' || path.startsWith('/tools/')}
          />
          {isAdmin && (
            <>
              <NavItem
                to="/admin/monitoring"
                icon="activity"
                label="Monitoring"
                collapsed={collapsed}
                onClick={onLinkClick}
                activeWhen={isMonitoringPath}
              />
              <NavItem
                to="/admin"
                icon="settings"
                label="Admin"
                collapsed={collapsed}
                onClick={onLinkClick}
                activeWhen={isAdminPath}
              />
            </>
          )}
        </div>
      </div>

      {/* Footer — pinned at bottom */}
      <div style={{ borderTop: '1px solid var(--color-border)' }}>
        <NavItem to="/settings" icon="settings" label="Settings" collapsed={collapsed} onClick={onLinkClick} />

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-full py-2 hover:opacity-70 transition-all"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ color: 'var(--color-muted)' }}
        >
          <span
            style={{
              display: 'inline-flex',
              transition: 'transform 200ms',
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            {getIcon('chevron-left', { size: 15 })}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col fixed top-14 bottom-0 left-0 z-40 overflow-hidden"
        style={{
          width: sidebarWidth,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          transition: 'width 200ms ease',
        }}
      >
        <SidebarContent collapsed={sidebarCollapsed} onLinkClick={undefined} />
      </aside>

      {/* Mobile sidebar */}
      <>
        {/* Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={onClose}
          />
        )}

        <aside
          className="md:hidden fixed top-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden"
          style={{
            width: 220,
            background: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 200ms ease',
          }}
        >
          {/* Mobile top padding (accounts for TopNav) */}
          <div className="h-14" />
          <SidebarContent collapsed={false} onLinkClick={onClose} />
        </aside>
      </>
    </>
  );
}
