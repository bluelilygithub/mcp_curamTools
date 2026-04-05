import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeProvider from './providers/ThemeProvider';
import { IconProvider } from './providers/IconProvider';
import { ToastProvider } from './components/ui/Toast';
import RequireAuth from './guards/RequireAuth';
import RequireRole from './guards/RequireRole';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminModelsPage from './pages/admin/AdminModelsPage';
import AdminAgentsPage from './pages/admin/AdminAgentsPage';
import AdminAppSettingsPage from './pages/admin/AdminAppSettingsPage';
import AdminEmailTemplatesPage from './pages/admin/AdminEmailTemplatesPage';
import AdminSecurityPage from './pages/admin/AdminSecurityPage';
import AdminLogsPage from './pages/admin/AdminLogsPage';
import AdminMcpServersPage from './pages/admin/AdminMcpServersPage';
import AdminMcpResourcesPage from './pages/admin/AdminMcpResourcesPage';
import AdminDiagnosticsPage from './pages/admin/AdminDiagnosticsPage';
import AdminSqlPage from './pages/admin/AdminSqlPage';
import AdminPromptsPage from './pages/admin/AdminPromptsPage';
import AdminDepartmentsPage from './pages/admin/AdminDepartmentsPage';
import AdminOrgRolesPage from './pages/admin/AdminOrgRolesPage';
import AdminCrmPrivacyPage from './pages/admin/AdminCrmPrivacyPage';
import AdminKnowledgePage from './pages/admin/AdminKnowledgePage';
import GoogleAdsMonitorPage from './pages/tools/GoogleAdsMonitorPage';
import DocExtractorPage from './pages/tools/DocExtractorPage';

export default function App() {
  return (
    <ThemeProvider>
      <IconProvider>
        <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/invite/:token" element={<LoginPage mode="register" />} />
            <Route path="/reset-password/:token" element={<LoginPage mode="reset" />} />

            {/* Authenticated */}
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/tools/google-ads-monitor" element={<GoogleAdsMonitorPage />} />
                <Route path="/tools/doc-extractor" element={<DocExtractorPage />} />

                {/* Admin-only */}
                <Route element={<RequireRole allowedRoles={['org_admin']} />}>
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                  <Route path="/admin/models" element={<AdminModelsPage />} />
                  <Route path="/admin/agents" element={<AdminAgentsPage />} />
                  <Route path="/admin/settings" element={<AdminAppSettingsPage />} />
                  <Route path="/admin/email-templates" element={<AdminEmailTemplatesPage />} />
                  <Route path="/admin/security" element={<AdminSecurityPage />} />
                  <Route path="/admin/logs" element={<AdminLogsPage />} />
                  <Route path="/admin/mcp-servers" element={<AdminMcpServersPage />} />
                  <Route path="/admin/mcp-resources" element={<AdminMcpResourcesPage />} />
                  <Route path="/admin/diagnostics" element={<AdminDiagnosticsPage />} />
                  <Route path="/admin/sql" element={<AdminSqlPage />} />
                  <Route path="/admin/prompts" element={<AdminPromptsPage />} />
                  <Route path="/admin/departments" element={<AdminDepartmentsPage />} />
                  <Route path="/admin/org-roles" element={<AdminOrgRolesPage />} />
                  <Route path="/admin/crm-privacy" element={<AdminCrmPrivacyPage />} />
                  <Route path="/admin/knowledge" element={<AdminKnowledgePage />} />
                </Route>
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        </ToastProvider>
      </IconProvider>
    </ThemeProvider>
  );
}
