import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@automata/shared';
import { Layout } from './components/Layout';
import { EmptyState, Spinner, Toasts } from './components/ui';
import { useAuth } from './lib/stores';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AlgorithmsPage } from './pages/AlgorithmsPage';
import { AssignmentPage } from './pages/AssignmentPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CoursePage } from './pages/CoursePage';
import { CoursesPage } from './pages/CoursesPage';
import { DashboardPage } from './pages/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { GrammarPage } from './pages/GrammarPage';
import { PracticePage, PracticeSolvePage } from './pages/PracticePages';
import { RegexPage } from './pages/RegexPage';

/** Redirect signed-out visitors to the login page, remembering where they wanted to go. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Client-side role gate. The API enforces the same rule; this only avoids showing a dead page. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || !roles.includes(user.role)) return <EmptyState title="You do not have access to this page.">This area is limited to {roles.join(' / ')} accounts.</EmptyState>;
  return <>{children}</>;
}

export function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="editor" element={<EditorPage />} />
          <Route path="algorithms" element={<AlgorithmsPage />} />
          <Route path="regex" element={<RegexPage />} />
          <Route path="grammar" element={<GrammarPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="practice/:id" element={<PracticeSolvePage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:id" element={<CoursePage />} />
          <Route path="assignments/:id" element={<AssignmentPage />} />
          <Route
            path="admin/users"
            element={
              <RequireRole roles={['admin']}>
                <AdminUsersPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<EmptyState title="Page not found">The page you are looking for does not exist.</EmptyState>} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
