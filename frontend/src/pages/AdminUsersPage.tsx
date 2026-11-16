import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { roleSchema, type Profile, type Role } from '@automata/shared';
import { Card, ErrorState, formatDate, IconButton, PageHeader, Spinner, useFetch } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast, useAuth } from '../lib/stores';

export function AdminUsersPage() {
  const me = useAuth((s) => s.user)!;
  const { data, error, loading, reload } = useFetch<{ users: Profile[] }>('/admin/users');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load users.'} onRetry={reload} />;

  const q = query.trim().toLowerCase();
  const users = data.users.filter((u) => !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role === q);

  const setRole = async (user: Profile, role: Role) => {
    setBusyId(user.id);
    try {
      await api.patch(`/admin/users/${user.id}`, { role });
      toast('success', `${user.full_name} is now ${role === 'admin' ? 'an admin' : `a ${role}`}.`);
      reload();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (user: Profile) => {
    if (!window.confirm(`Delete the account of ${user.full_name} (${user.email})? Their courses, submissions and saved automata are deleted too. This cannot be undone.`)) return;
    setBusyId(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast('success', 'Account deleted.');
      reload();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Change roles or remove accounts. You cannot demote or delete your own account." actions={<input className="input !w-56" type="search" placeholder="Search name, email or role" aria-label="Search users" value={query} onChange={(e) => setQuery(e.target.value)} />} />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">
                    {u.full_name} {u.id === me.id && <span className="text-xs font-normal text-muted">(you)</span>}
                  </td>
                  <td className="text-muted">{u.email}</td>
                  <td>
                    <select className="input !w-auto !py-1 text-xs" aria-label={`Role of ${u.full_name}`} value={u.role} disabled={u.id === me.id || busyId === u.id} onChange={(e) => setRole(u, roleSchema.parse(e.target.value))}>
                      {roleSchema.options.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap text-muted">{formatDate(u.created_at, false)}</td>
                  <td className="text-right">
                    <IconButton label={`Delete ${u.full_name}`} disabled={u.id === me.id || busyId === u.id} onClick={() => remove(u)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted">
                    No users match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
