import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import AppShell from './AppShell';
import DemoShell from './DemoShell';

export default function OrgShell() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const isDemo = user?.orgType === 'demo';

  useEffect(() => {
    if (isDemo && !location.pathname.startsWith('/demo')) {
      navigate('/demo/dashboard', { replace: true });
    }
  }, [isDemo, location.pathname, navigate]);

  if (isDemo) return <DemoShell />;
  return <AppShell />;
}
