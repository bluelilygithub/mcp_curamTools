import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

/**
 * RequireRole — checks user.roles[].name against allowedRoles.
 * Redirects / on fail.
 * org_admin always passes.
 */
export default function RequireRole({ allowedRoles = [] }) {
  const { user } = useAuthStore();

  if (!user) return <Navigate to="/login" replace />;

  const roleNames = (user.roles ?? []).map((r) => r.name);
  const permitted =
    roleNames.includes('org_admin') ||
    allowedRoles.some((r) => roleNames.includes(r));

  if (!permitted) return <Navigate to="/" replace />;

  return <Outlet />;
}
