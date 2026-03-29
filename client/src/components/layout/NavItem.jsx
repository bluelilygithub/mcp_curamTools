import { NavLink } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';

/**
 * NavItem — sidebar navigation link.
 * Active state: rgba(var(--color-primary-rgb), 0.1) tint, primary text, semibold.
 * Icon colour inherits from parent via color: inherit.
 * mx-2 inset keeps tint away from sidebar edges.
 */
export default function NavItem({ to, icon, label, collapsed, onClick }) {
  const getIcon = useIcon();

  return (
    <NavLink
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg transition-all text-sm"
      style={({ isActive }) => ({
        background: isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
        fontWeight: isActive ? 600 : 400,
        textDecoration: 'none',
      })}
    >
      <span className="shrink-0" style={{ color: 'inherit' }}>
        {getIcon(icon, { size: 15 })}
      </span>
      {!collapsed && (
        <span className="whitespace-nowrap overflow-hidden">{label}</span>
      )}
    </NavLink>
  );
}
