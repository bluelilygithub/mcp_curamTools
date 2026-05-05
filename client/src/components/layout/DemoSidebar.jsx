import { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import NavItem from './NavItem';
import api from '../../api/client';

const SIDEBAR_WIDTH = 220;

export default function DemoSidebar({ mobileOpen, onClose }) {
  const getIcon = useIcon();
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    api.get('/demo/manifest')
      .then(setAgents)
      .catch(() => {});
  }, []);

  const SidebarContent = ({ onLinkClick }) => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="pt-3">
          <NavItem to="/demo/dashboard" icon="dashboard" label="Dashboard" onClick={onLinkClick} />
        </div>

        {agents.length > 0 && (
          <div className="mt-2">
            <p
              className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)' }}
            >
              Agents
            </p>
            {agents.map((agent) => (
              <NavItem
                key={agent.slug}
                to={`/demo/run/${agent.slug}`}
                icon={agent.icon}
                label={agent.name}
                onClick={onLinkClick}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)' }}>
        <NavItem to="/settings" icon="settings" label="Settings" onClick={onLinkClick} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col fixed top-14 bottom-0 left-0 z-40 overflow-hidden"
        style={{
          width: SIDEBAR_WIDTH,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        <SidebarContent onLinkClick={undefined} />
      </aside>

      {/* Mobile sidebar */}
      <>
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
            width: SIDEBAR_WIDTH,
            background: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 200ms ease',
          }}
        >
          <div className="h-14" />
          <SidebarContent onLinkClick={onClose} />
        </aside>
      </>
    </>
  );
}
