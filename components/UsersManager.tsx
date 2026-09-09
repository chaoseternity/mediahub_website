"use client";

import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil, Check, X } from "lucide-react";
import type { User, Role } from "@/lib/types";
import { roleBadgeClass } from "@/lib/utils";

const ROLE_OPTIONS: Role[] = ["admin", "verified", "viewer"];

interface UsersManagerProps {
  users: User[];
  currentUserId: string;
}

export function UsersManager({ users: initialUsers, currentUserId }: UsersManagerProps) {
  const [users, setUsers] = useState(initialUsers);
  const [editing, setEditing] = useState<number | null>(null);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [editingUsername, setEditingUsername] = useState<number | null>(null);
  const [pendingUsername, setPendingUsername] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing !== null) selectRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (editingUsername !== null) usernameInputRef.current?.focus();
  }, [editingUsername]);

  function startEdit(user: User) {
    setEditing(user.id);
    setPendingRole(user.role);
  }

  function cancelEdit() {
    setEditing(null);
    setPendingRole(null);
  }

  function startUsernameEdit(user: User) {
    setEditingUsername(user.id);
    setPendingUsername(user.username ?? "");
  }

  function cancelUsernameEdit() {
    setEditingUsername(null);
    setPendingUsername("");
  }

  async function commitUsernameEdit(userId: number) {
    const trimmed = pendingUsername.trim();
    if (!trimmed) return;
    setSaving(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to update username");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, username: trimmed } : u))
      );
      setEditingUsername(null);
      setPendingUsername("");
    } catch {
      setError("Failed to update username. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function commitEdit(userId: number) {
    if (!pendingRole) return;
    const newRole = pendingRole;
    setSaving(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error("Failed to update role");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      setEditing(null);
      setPendingRole(null);
    } catch {
      setError("Failed to update role. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(userId: number, name: string) {
    if (!confirm(`Remove ${name} from the system? This cannot be undone.`)) return;
    setDeleting(userId);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      setError("Failed to delete user. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[140px]">OAuth Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[160px]">Username</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[200px]">Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[100px]">Provider</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[140px]">Role</th>
              <th className="px-4 py-3 min-w-[48px]" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => {
              const isSelf = String(user.id) === currentUserId;
              const isEditing = editing === user.id;
              return (
                <tr key={user.id} className="h-14 hover:bg-muted/30 transition-colors">
                  <td className="px-4 align-middle">
                    <div className="font-medium whitespace-nowrap">{user.name}</div>
                  </td>
                  <td className="px-4 align-middle">
                    {editingUsername === user.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={usernameInputRef}
                          value={pendingUsername}
                          maxLength={50}
                          disabled={saving === user.id}
                          onChange={(e) => setPendingUsername(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitUsernameEdit(user.id);
                            if (e.key === "Escape") cancelUsernameEdit();
                          }}
                          className="text-xs rounded-md border bg-background px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Confirm"
                          disabled={saving === user.id || !pendingUsername.trim()}
                          onClick={() => commitUsernameEdit(user.id)}
                          className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Cancel"
                          onClick={cancelUsernameEdit}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {user.username
                          ? <span className="font-medium">{user.username}</span>
                          : <span className="text-muted-foreground text-xs italic">not set</span>}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit username for ${user.name}`}
                          onClick={() => startUsernameEdit(user)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 align-middle text-muted-foreground whitespace-nowrap">{user.email}</td>
                  <td className="px-4 align-middle">
                    <Badge variant="outline" className="capitalize text-xs whitespace-nowrap">
                      {user.provider === "microsoft-entra-id" ? "Microsoft" : (user.provider ?? "—")}
                    </Badge>
                  </td>
                  <td className="px-4 align-middle">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          ref={selectRef}
                          value={pendingRole ?? user.role}
                          disabled={saving === user.id}
                          onChange={(e) => setPendingRole(e.target.value as Role)}
                          className="text-xs rounded-md border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Confirm"
                          disabled={saving === user.id}
                          onClick={() => commitEdit(user.id)}
                          className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Cancel"
                          onClick={cancelEdit}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Badge className={roleBadgeClass[user.role]}>{user.role}</Badge>
                        {!isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit role for ${user.name}`}
                            onClick={() => startEdit(user)}
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 align-middle text-right">
                    {!isSelf && !isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${user.name}`}
                        disabled={deleting === user.id}
                        onClick={() => handleDelete(user.id, user.name)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {users.length} user{users.length !== 1 ? "s" : ""} total. Your own account cannot be modified here.
      </p>
    </div>
  );
}

