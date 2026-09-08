'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { User, UserRole } from '@/trpc/routers/user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface UsersClientPageProps {
  initialUsers: User[];
}

// One form for both halves of the sheet. `password` is a required temporary
// password when inviting and an optional replacement when editing — the same
// field, because to the person filling it in it's the same question.
type UserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

const emptyForm: UserForm = { name: '', email: '', password: '', role: 'Member' };

function userToForm(user: User): UserForm {
  return {
    name: user.name,
    email: user.email,
    password: '',
    role: (user.role as UserRole | null) ?? 'Member',
  };
}

export default function UsersClientPage({ initialUsers }: UsersClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    ...trpc.user.getAll.queryOptions(),
    initialData: initialUsers,
  });
  const users = usersQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');

  // Same shape as every other dashboard page: one sheet, opened either empty
  // (invite) or seeded from a row (edit), with editingId deciding which.
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<UserForm>(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: trpc.user.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  };

  const createUser = useMutation(
    trpc.user.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updateUser = useMutation(
    trpc.user.update.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        // The sidebar's account menu reads `me`; editing yourself from this
        // page has to update it too.
        queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const deleteUser = useMutation(
    trpc.user.delete.mutationOptions({
      onSuccess: () => invalidateAll(),
      onError: (error) => setFormError(error.message),
    }),
  );

  // Filter search
  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingId(user.id);
    setForm(userToForm(user));
    setFormError(null);
    setIsFormOpen(true);
  };

  const isSaving = createUser.isPending || updateUser.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email) return;

    if (editingId) {
      updateUser.mutate({
        id: editingId,
        name: form.name,
        email: form.email,
        role: form.role,
        // Empty means "keep the current password", not "clear it".
        newPassword: form.password || undefined,
      });
      return;
    }

    if (!form.password) return;
    createUser.mutate(form);
  };

  const handleDeleteUser = (id: string) => {
    deleteUser.mutate({ id });
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users & Team</h1>
          <p className="text-sm text-muted-foreground">
            Manage team members, roles, and access permissions for your organization.
          </p>
        </div>

        <Button className="gap-2" onClick={openCreate}>
          <UserPlus className="h-4 w-4" />
          Invite User
        </Button>
      </div>

      {/* Invite/Edit Sheet */}
      <Sheet
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <SheetContent side="right" className="sm:max-w-md w-full">
          <SheetHeader>
            <SheetTitle>{editingId ? 'Edit User' : 'Invite New User'}</SheetTitle>
            <SheetDescription>
              {editingId
                ? "Change this user's name, sign-in address, role or password."
                : 'Create an account for a new team member directly — self-service registration is closed once the first account exists.'}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="user-name">Name</Label>
                <Input
                  id="user-name"
                  placeholder="e.g. John Doe"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  minLength={2}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="user-email">Email Address</Label>
                <Input
                  id="user-email"
                  type="email"
                  placeholder="john@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="user-password">
                  {editingId ? 'New Password' : 'Temporary Password'}
                </Label>
                <Input
                  id="user-password"
                  type="password"
                  placeholder={
                    editingId ? 'Leave blank to keep the current one' : 'At least 8 characters'
                  }
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={!editingId}
                  minLength={8}
                  autoComplete="new-password"
                />
                {editingId && (
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters. The user stays signed in on devices they are already
                    signed in on.
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="user-role">Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(value) => {
                    if (value) setForm({ ...form, role: value as UserRole });
                  }}
                >
                  <SelectTrigger id="user-role">
                    <SelectValue>{(val: UserRole) => val}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Admin">Admin</SelectItem>
                    <SelectItem value="Member">Member</SelectItem>
                    <SelectItem value="Viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <div className="flex gap-2 w-full">
                <Button type="button" variant="outline" className="flex-1" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={isSaving}>
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create User'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Search Bar */}
      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  {/* Name & Avatar */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={user.image ?? undefined} alt={user.name} />
                        <AvatarFallback>
                          {user.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{user.name}</span>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    </div>
                  </TableCell>

                  {/* Date */}
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>

                  {/* Actions Dropdown Menu */}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openEdit(user)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteUser(user.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
