import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeProvider from './providers/ThemeProvider';
import { IconProvider } from './providers/IconProvider';
import { ToastProvider } from './components/ui/Toast';
import RequireAuth from './guards/RequireAuth';
import RequireRole from './guards/RequireRole';
import OrgShell from './components/layout/OrgShell';

// ── Eager (always needed at boot) ─────────────────────────────────────────────
import LoginPage from './pages/LoginPage';

// ── Lazy page chunks ──────────────────────────────────────────────────────────
const DashboardPage                 = lazy(() => import('./pages/DashboardPage'));
const ToolLibraryPage               = lazy(() => import('./pages/ToolLibraryPage'));
const SettingsPage                  = lazy(() => import('./pages/SettingsPage'));

const GoogleAdsMonitorPage          = lazy(() => import('./pages/tools/GoogleAdsMonitorPage'));
const DiamondPlateDataPage          = lazy(() => import('./pages/tools/DiamondPlateDataPage'));
const DocExtractorPage              = lazy(() => import('./pages/tools/DocExtractorPage'));
const MediaGenPage                  = lazy(() => import('./pages/tools/MediaGenPage'));
const HighIntentAdvisorPage         = lazy(() => import('./pages/tools/HighIntentAdvisorPage'));
const NotInterestedReportPage       = lazy(() => import('./pages/tools/NotInterestedReportPage'));
const AdsSetupArchitectPage         = lazy(() => import('./pages/profitabilitySuite/adsSetupArchitect/AdsSetupArchitectPage'));
const CampaignDashboardPage         = lazy(() => import('./pages/tools/CampaignDashboardPage'));
const WpThemeExtractorPage          = lazy(() => import('./pages/tools/WpThemeExtractorPage'));
const SpecValidatorPage             = lazy(() => import('./pages/tools/SpecValidatorPage'));

const AdminHubPage                  = lazy(() => import('./pages/admin/AdminHubPage'));
const AdminUsersPage                = lazy(() => import('./pages/admin/AdminUsersPage'));
const AdminOrganizationsPage        = lazy(() => import('./pages/admin/AdminOrganizationsPage'));
const AdminModelsPage               = lazy(() => import('./pages/admin/AdminModelsPage'));
const AdminAgentsPage               = lazy(() => import('./pages/admin/AdminAgentsPage'));
const AdminAppSettingsPage          = lazy(() => import('./pages/admin/AdminAppSettingsPage'));
const AdminEmailTemplatesPage       = lazy(() => import('./pages/admin/AdminEmailTemplatesPage'));
const AdminSecurityPage             = lazy(() => import('./pages/admin/AdminSecurityPage'));
const AdminLogsPage                 = lazy(() => import('./pages/admin/AdminLogsPage'));
const AdminMcpServersPage           = lazy(() => import('./pages/admin/AdminMcpServersPage'));
const AdminMcpResourcesPage         = lazy(() => import('./pages/admin/AdminMcpResourcesPage'));
const AdminDiagnosticsPage          = lazy(() => import('./pages/admin/AdminDiagnosticsPage'));
const AdminSqlPage                  = lazy(() => import('./pages/admin/AdminSqlPage'));
const AdminPromptsPage              = lazy(() => import('./pages/admin/AdminPromptsPage'));
const AdminDepartmentsPage          = lazy(() => import('./pages/admin/AdminDepartmentsPage'));
const AdminOrgRolesPage             = lazy(() => import('./pages/admin/AdminOrgRolesPage'));
const AdminCrmPrivacyPage           = lazy(() => import('./pages/admin/AdminCrmPrivacyPage'));
const AdminDataPrivacyPage          = lazy(() => import('./pages/admin/AdminDataPrivacyPage'));
const AdminStoragePage              = lazy(() => import('./pages/admin/AdminStoragePage'));
const AdminCompetitorsPage          = lazy(() => import('./pages/admin/AdminCompetitorsPage'));
const AdminKnowledgePage            = lazy(() => import('./pages/admin/AdminKnowledgePage'));
const AdminLessonsPage              = lazy(() => import('./pages/admin/AdminLessonsPage'));
const AdminProvidersPage            = lazy(() => import('./pages/admin/AdminProvidersPage'));
const AdminMonitoringPage           = lazy(() => import('./pages/admin/AdminMonitoringPage'));
const AdminOperationsOverviewPage   = lazy(() => import('./pages/admin/AdminOperationsOverviewPage'));
const AdminUsagePage                = lazy(() => import('./pages/admin/AdminUsagePage'));
const AdminAgentTrustPage           = lazy(() => import('./pages/admin/AdminAgentTrustPage'));
const AdminClaudeSessionPage        = lazy(() => import('./pages/admin/AdminClaudeSessionPage'));

const DemoDashboardPage             = lazy(() => import('./pages/demo/DemoDashboardPage'));
const DocumentAnalyzer              = lazy(() => import('./pages/demo/DocumentAnalyzer'));
const SpecValidator                 = lazy(() => import('./pages/demo/SpecValidator'));
const TenderResponseGenerator       = lazy(() => import('./pages/demo/TenderResponseGenerator'));
const DecisionLogPage               = lazy(() => import('./pages/demo/DecisionLogPage'));
const TransactionLogPage            = lazy(() => import('./pages/logs/TransactionLogPage'));
const AgentEventLogPage             = lazy(() => import('./pages/logs/AgentEventLogPage'));

// ── Fallback shown while a chunk loads ────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>Loading…</span>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <IconProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public */}
                <Route path="/login"                    element={<LoginPage />} />
                <Route path="/invite/:token"            element={<LoginPage mode="register" />} />
                <Route path="/reset-password/:token"    element={<LoginPage mode="reset" />} />

                {/* Authenticated */}
                <Route element={<RequireAuth />}>
                  <Route element={<OrgShell />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard"                     element={<DashboardPage />} />
                    <Route path="/tools"                         element={<ToolLibraryPage />} />
                    <Route path="/settings"                      element={<SettingsPage />} />
                    <Route path="/tools/google-ads-monitor"      element={<GoogleAdsMonitorPage />} />
                    <Route path="/tools/diamondplate-data"       element={<DiamondPlateDataPage />} />
                    <Route path="/tools/doc-extractor"           element={<DocExtractorPage />} />
                    <Route path="/tools/media-gen"               element={<MediaGenPage />} />
                    <Route path="/tools/high-intent-advisor"     element={<HighIntentAdvisorPage />} />
                    <Route path="/tools/not-interested-report"   element={<NotInterestedReportPage />} />
                    <Route path="/tools/ads-setup-architect"     element={<AdsSetupArchitectPage />} />
                    <Route path="/tools/campaign-dashboard"      element={<CampaignDashboardPage />} />
                    <Route path="/tools/wp-theme-extractor"      element={<WpThemeExtractorPage />} />
                    <Route path="/tools/spec-validator"          element={<SpecValidatorPage />} />

                    {/* Admin-only */}
                    <Route element={<RequireRole allowedRoles={['org_admin']} />}>
                      <Route path="/admin"                             element={<AdminHubPage />} />
                      <Route path="/admin/organizations"               element={<AdminOrganizationsPage />} />
                      <Route path="/admin/users"                       element={<AdminUsersPage />} />
                      <Route path="/admin/models"                      element={<AdminModelsPage />} />
                      <Route path="/admin/agents"                      element={<AdminAgentsPage />} />
                      <Route path="/admin/settings"                    element={<AdminAppSettingsPage />} />
                      <Route path="/admin/email-templates"             element={<AdminEmailTemplatesPage />} />
                      <Route path="/admin/security"                    element={<AdminSecurityPage />} />
                      <Route path="/admin/logs"                        element={<AdminLogsPage />} />
                      <Route path="/admin/mcp-servers"                 element={<AdminMcpServersPage />} />
                      <Route path="/admin/mcp-resources"               element={<AdminMcpResourcesPage />} />
                      <Route path="/admin/diagnostics"                 element={<AdminDiagnosticsPage />} />
                      <Route path="/admin/sql"                         element={<AdminSqlPage />} />
                      <Route path="/admin/prompts"                     element={<AdminPromptsPage />} />
                      <Route path="/lessons"                           element={<Navigate to="/admin/lessons" replace />} />
                      <Route path="/admin/departments"                 element={<AdminDepartmentsPage />} />
                      <Route path="/admin/org-roles"                   element={<AdminOrgRolesPage />} />
                      <Route path="/admin/crm-privacy"                 element={<AdminCrmPrivacyPage />} />
                      <Route path="/admin/data-privacy"                element={<AdminDataPrivacyPage />} />
                      <Route path="/admin/storage"                     element={<AdminStoragePage />} />
                      <Route path="/admin/competitors"                 element={<AdminCompetitorsPage />} />
                      <Route path="/admin/knowledge"                   element={<AdminKnowledgePage />} />
                      <Route path="/admin/lessons"                     element={<AdminLessonsPage />} />
                      <Route path="/admin/providers"                   element={<AdminProvidersPage />} />
                      <Route path="/admin/monitoring"                  element={<AdminMonitoringPage />} />
                      <Route path="/admin/operations"                  element={<AdminOperationsOverviewPage />} />
                      <Route path="/admin/usage"                       element={<AdminUsagePage />} />
                      <Route path="/admin/agent-trust"                 element={<AdminAgentTrustPage />} />
                      <Route path="/admin/claude-sessions"             element={<AdminClaudeSessionPage />} />
                      <Route path="/admin/monitoring/decision-log"     element={<DecisionLogPage />} />
                      <Route path="/admin/monitoring/transactions"     element={<TransactionLogPage />} />
                      <Route path="/admin/monitoring/events"           element={<AgentEventLogPage />} />
                    </Route>

                    {/* Demo org routes */}
                    <Route path="/demo/dashboard"                      element={<DemoDashboardPage />} />
                    <Route path="/demo/run/demo-document-analyzer"     element={<DocumentAnalyzer />} />
                    <Route path="/demo/run/demo-spec-validator"        element={<SpecValidator />} />
                    <Route path="/demo/run/demo-tender-response"       element={<TenderResponseGenerator />} />
                    <Route path="/demo/decision-log"                   element={<DecisionLogPage />} />
                    <Route path="/demo/logs/transactions"              element={<TransactionLogPage />} />
                    <Route path="/demo/logs/events"                    element={<AgentEventLogPage />} />
                  </Route>
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </IconProvider>
    </ThemeProvider>
  );
}
