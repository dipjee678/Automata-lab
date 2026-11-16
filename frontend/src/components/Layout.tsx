import { BookOpen, Braces, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, Regex, Share2, Sun, Target, Users, Workflow, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '@automata/shared';
import { useAuth, useTheme } from '../lib/stores';
import { Badge, cx, IconButton } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
  end?: boolean;
}

const NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, end: true },
      { to: '/courses', label: 'Courses', icon: <GraduationCap className="h-4 w-4" /> },
      { to: '/practice', label: 'Practice', icon: <Target className="h-4 w-4" /> },
    ],
  },
  {
    heading: 'Laboratory',
    items: [
      { to: '/editor', label: 'Automata editor', icon: <Share2 className="h-4 w-4" /> },
      { to: '/algorithms', label: 'Conversions', icon: <Workflow className="h-4 w-4" /> },
      { to: '/regex', label: 'Regular expressions', icon: <Regex className="h-4 w-4" /> },
      { to: '/grammar', label: 'Grammars', icon: <Braces className="h-4 w-4" /> },
    ],
  },
  {
    heading: 'Administration',
    items: [{ to: '/admin/users', label: 'Users', icon: <Users className="h-4 w-4" />, roles: ['admin'] }],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);
  // Leave the protected area BEFORE clearing the session, so the login page does not
  // remember this user's last page and send the next person who signs in there.
  const signOut = () => {
    navigate('/login', { replace: true });
    logout();
  };
  if (!user) return null;

  // The editor gets the full viewport; other pages scroll inside a padded column.
  const fullBleed = location.pathname === '/editor';

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white dark:text-slate-950">
          <BookOpen className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Automata Lab</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (items.length === 0) return null;
          return (
            <div key={group.heading} className="mb-4">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.heading}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx('mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors', isActive ? 'bg-accent/10 font-medium text-accent' : 'text-ink/80 hover:bg-raised hover:text-ink')
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold uppercase">{user.full_name.slice(0, 2)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.full_name}</div>
            <Badge tone={user.role === 'admin' ? 'red' : user.role === 'teacher' ? 'violet' : 'blue'}>{user.role}</Badge>
          </div>
          <IconButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggle}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
          <IconButton label="Sign out" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 border-r border-line bg-panel lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-panel shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 lg:hidden">
          <IconButton label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </IconButton>
          <span className="text-sm font-semibold">Automata Lab</span>
          <div className="ml-auto">
            <IconButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggle}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </IconButton>
          </div>
        </header>
        <main className={cx('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
