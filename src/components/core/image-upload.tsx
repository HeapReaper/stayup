'use client';

import * as React from 'react';
import { ImageIcon, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_BYTES,
  humanBytes,
} from '@/lib/stored-files';

interface ImageUploadProps {
  /** The stored URL — `/api/files/<id>` for an upload, or any URL somebody typed. */
  value: string;
  onChange: (url: string) => void;
  /** Round for a profile picture, square for a logo. Cosmetic only. */
  shape?: 'square' | 'round';
  /** Alternative text for the preview, so a form with two of these is navigable. */
  alt?: string;
  className?: string;
}

/**
 * Upload-or-clear control for the one-image fields: a status page's logo and a
 * user's profile picture.
 *
 * It uploads immediately (to /api/files) and hands its parent the resulting
 * URL, which the parent saves with the rest of its form. That split is why the
 * upload endpoint is generic: the file has to exist before the form it belongs
 * to is submitted — a status page being created doesn't have an id yet. A file
 * whose form is then abandoned is never referenced and gets swept by the
 * janitor worker, which is a cheaper trade than a two-phase upload.
 */
export default function ImageUpload({ value, onChange, shape = 'square', alt = '', className }: ImageUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);

    // Pre-checked here purely so an obvious mistake doesn't cost an upload of
    // several megabytes; src/app/api/files/route.ts is the actual authority
    // and re-checks the bytes themselves.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${humanBytes(file.size)}; the limit is ${humanBytes(MAX_UPLOAD_BYTES)}`);
      return;
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      setError('Pick a PNG, JPEG, WebP or GIF image');
      return;
    }

    const body = new FormData();
    body.append('file', file);

    setPending(true);
    try {
      const response = await fetch('/api/files', { method: 'POST', body });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? `Upload failed (${response.status})`);
      }
      onChange(payload.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setPending(false);
      // Cleared so picking the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex size-14 shrink-0 items-center justify-center overflow-hidden border bg-muted',
            shape === 'round' ? 'rounded-full' : 'rounded-lg',
          )}
        >
          {value ? (
            // A plain <img>: the source is either this instance's own file
            // route or an arbitrary remote URL somebody pasted, and
            // next/image would need every one of those hosts allow-listed in
            // next.config.ts to render at all.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={alt} className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" /> {pending ? 'Uploading...' : value ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              disabled={pending}
              onClick={() => {
                setError(null);
                onChange('');
              }}
            >
              <Trash2 className="size-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
