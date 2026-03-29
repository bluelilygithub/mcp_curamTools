import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

/**
 * RequireAuth — checks authStore.token; redirects /login on fail.
 */
export default function RequireAuth() {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}
