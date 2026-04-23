/**
 * Sidebar — 220px expanded / 56px collapsed.
 * Desktop: fixed, top: 56px to bottom.
 * Mobile: overlay with backdrop.
 * Labelled sections: Tools, Admin.
 * Collapse state persists to toolStore.
 */
import { useEffect, useRef } from 'react';
import { useIcon } from '../../providers/IconProvider';
import NavItem from './NavItem';
import useToolStore from '../../stores/toolStore';
import useAuthStore from '../../stores/authStore';
import { getPermittedToolGroups } from '../../config/tools';

export default function Sidebar({ mobileOpen, onClose }) {
  const getIcon = useIcon();
  const { sidebarCollapsed, toggleSidebar } = useToolStore();
  const { user } = useAuthStore();

  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const isAdmin = primaryRole === 'org_admin';
  const toolGroups = getPermittedToolGroups(primaryRole);

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
        {/* Dashboard — no section label */}
        <div className="pt-3">
          <NavItem to="/dashboard" icon="dashboard" label="Dashboard" collapsed={collapsed} onClick={onLinkClick} />
        </div>

        {/* Tools section */}
        {toolGroups.length > 0 && (
          <div className="mt-2">
            {!collapsed && (
              <p
                className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-muted)' }}
              >
                Tools
              </p>
            )}
            {collapsed && <div className="pt-3" />}
            {toolGroups.map(({ group, tools }) => (
              <div key={group}>
                {!collapsed && toolGroups.length > 1 && (
                  <p
                    className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider"
                    style={{ color: 'var(--color-muted)', opacity: 0.6 }}
                  >
                    {group}
                  </p>
                )}
                {tools.map((tool) => (
                  <NavItem
                    key={tool.id}
                    to={tool.path}
                    icon={tool.icon}
                    label={tool.name}
                    collapsed={collapsed}
                    onClick={onLinkClick}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-2 pb-2">
            {!collapsed && (
              <p
                className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-muted)' }}
              >
                Admin
              </p>
            )}
            {collapsed && <div className="pt-3" />}

            {/* Users & Access */}
            {!collapsed && (
              <p className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                Users & Access
              </p>
            )}
            <NavItem to="/admin/users" icon="users" label="Users" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/departments" icon="bookmark" label="Departments" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/org-roles" icon="tag" label="Org Roles" collapsed={collapsed} onClick={onLinkClick} />

            {/* AI & MCP */}
            {!collapsed && (
              <p className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                AI & MCP
              </p>
            )}
            <NavItem to="/admin/models" icon="cpu" label="Models" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/providers" icon="globe" label="Providers" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/agents" icon="bot" label="Agents" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/mcp-servers" icon="server" label="MCP Servers" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/mcp-resources" icon="layers" label="MCP Resources" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/prompts" icon="file-text" label="MCP Prompts" collapsed={collapsed} onClick={onLinkClick} />

            {/* Content */}
            {!collapsed && (
              <p className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                Content
              </p>
            )}
            <NavItem to="/admin/email-templates" icon="mail" label="Email Templates" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/knowledge" icon="book-open" label="Knowledge Base" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/competitors" icon="target" label="Competitors" collapsed={collapsed} onClick={onLinkClick} />

            {/* Monitoring */}
            {!collapsed && (
              <p className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                Monitoring
              </p>
            )}
            <NavItem to="/admin/usage" icon="trending-up" label="Token Usage" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/claude-sessions" icon="clock" label="Claude Sessions" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/logs" icon="activity" label="Logs" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/diagnostics" icon="zap" label="Diagnostics" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/sql" icon="database" label="SQL Console" collapsed={collapsed} onClick={onLinkClick} />

            {/* System */}
            {!collapsed && (
              <p className="px-3 pt-3 pb-0.5 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                System
              </p>
            )}
            <NavItem to="/admin/settings" icon="settings" label="App Settings" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/security" icon="shield" label="Security" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/data-privacy" icon="eye-off" label="Data Privacy" collapsed={collapsed} onClick={onLinkClick} />
            <NavItem to="/admin/storage" icon="archive" label="File Storage" collapsed={collapsed} onClick={onLinkClick} />
          </div>
        )}
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
