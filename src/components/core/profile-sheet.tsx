'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '@/trpc/client';
import type { User } from '@/trpc/routers/user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ImageUpload from '@/components/core/image-upload';
import TwoFactorSettings from '@/components/core/two-factor-settings';
import { humanBytes, MAX_UPLOAD_BYTES } from '@/lib/stored-files';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface ProfileSheetProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Edit profile", opened from the account menu at the bottom of the sidebar.
 * Only ever edits the signed-in user — the Users page edits everyone else,
 * through the same tRPC router but a mutation that can also set a role.
 *
 * A sheet, like every other edit form in the dashboard, rather than a modal.
 */
export default function ProfileSheet({ user, open, onOpenChange }: ProfileSheetProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [form, setForm] = React.useState({
    name: user.name,
    email: user.email,
    newPassword: '',
    image: user.image ?? '',
  });
  const [formError, setFormError] = React.useState<string | null>(null);

  // Re-seed from the current user every time it opens, so a cancelled edit
  // doesn't linger in the fields and a change made elsewhere shows up.
  React.useEffect(() => {
    if (open) {
      setForm({ name: user.name, email: user.email, newPassword: '', image: user.image ?? '' });
      setFormError(null);
    }
  }, [open, user.name, user.email, user.image]);

  const updateProfile = useMutation(
    trpc.user.updateProfile.mutationOptions({
      onSuccess: () => {
        // Both: the sidebar reads `me`, the Users page reads `getAll`, and
        // the row for this user is now stale in the second one too.
        queryClient.invalidateQueries({ queryKey: trpc.user.me.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.user.getAll.queryKey() });
        onOpenChange(false);
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate({
      name: form.name,
      email: form.email,
      // Empty means "keep the current password" — the router treats it that way.
      newPassword: form.newPassword || undefined,
      // Always sent, unlike the password: '' is how this form removes a
      // picture, and the router only leaves the column alone when the field is
      // absent entirely.
      image: form.image,
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <SheetContent side="right" className="sm:max-w-md w-full">
        <SheetHeader>
          <SheetTitle>Your profile</SheetTitle>
          <SheetDescription>
            Change your name, sign-in address or password. Signing in uses the e-mail below.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            <div className="grid gap-2">
              <Label>Profile picture</Label>
              <ImageUpload
                value={form.image}
                onChange={(url) => setForm((prev) => ({ ...prev, image: url }))}
                shape="round"
                alt="Your profile picture"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the account menu and on the Users page. PNG, JPEG, WebP or GIF, up to{' '}
                {humanBytes(MAX_UPLOAD_BYTES)}.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                minLength={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email Address</Label>
              <Input
                id="profile-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-password">New Password</Label>
              <Input
                id="profile-password"
                type="password"
                placeholder="Leave blank to keep your current one"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                minLength={8}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters. Other devices you are signed in on stay signed in.
              </p>
            </div>

            {/* Outside the tRPC round-trip the rest of this form makes: 2FA
                enrolment talks to better-auth directly, and its state is the
                plugin's rather than this form's. */}
            <TwoFactorSettings enabled={user.twoFactorEnabled === true} />

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <SheetFooter>
            <div className="flex gap-2 w-full">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
