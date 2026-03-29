/**
 * AppShell — top-level authenticated layout.
 * Derives isAdmin once from authStore roles.
 * Uses in-flow spacer technique: sidebar is fixed, spacer div mirrors width in flex row.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import useToolStore from '../../stores/toolStore';
import useAuthStore from '../../stores/authStore';

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { sidebarCollapsed } = useToolStore();
  const { user } = useAuthStore();

  // Single derivation point — isAdmin flows down to Sidebar and guards from here
  const primaryRole = user?.roles?.find((r) => r.scope_type === 'global')?.name;
  const isAdmin = primaryRole === 'org_admin';

  const sidebarWidth = sidebarCollapsed ? 56 : 220;

  return (
    <div
      className="flex flex-col"
      style={{ minHeight: '100vh', minHeight: '100dvh' }}
    >
      <TopNav onMenuClick={() => setMobileOpen(true)} />

      <div className="flex flex-1 pt-14">
        {/* In-flow spacer — mirrors sidebar width so content is never obscured */}
        <div
          className="hidden md:block shrink-0"
          style={{
            width: sidebarWidth,
            transition: 'width 200ms ease',
          }}
        />

        <Sidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          isAdmin={isAdmin}
        />

        {/* Main content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ background: 'var(--color-bg)' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
