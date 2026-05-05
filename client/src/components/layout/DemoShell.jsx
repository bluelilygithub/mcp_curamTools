import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import DemoSidebar from './DemoSidebar';

const SIDEBAR_WIDTH = 220;

export default function DemoShell() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex flex-col" style={{ minHeight: '100dvh' }}>
      <TopNav onMenuClick={() => setMobileOpen(true)} />

      <div className="flex flex-1 pt-14">
        {/* In-flow spacer — mirrors sidebar width so content is never obscured */}
        <div className="hidden md:block shrink-0" style={{ width: SIDEBAR_WIDTH }} />

        <DemoSidebar
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />

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
