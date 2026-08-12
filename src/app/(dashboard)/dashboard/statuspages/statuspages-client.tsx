'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Globe,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Users,
  Copy,
  X,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type {
  StatusPageSummary,
  StatusPageDetail,
  StatusPageTheme,
  HistoryWindowDays,
} from '@/trpc/routers/statuspage';
import type { Monitor } from '@/trpc/routers/monitor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StatusPagesClientPageProps {
  initialStatusPages: StatusPageSummary[];
  monitors: Monitor[];
}

const UNGROUPED = -1;
const REMOVE_FROM_PAGE = 'remove';

type FormState = {
  name: string;
  slug: string;
  slugTouched: boolean;
  customDomain: string;
  description: string;
  logoUrl: string;
  theme: StatusPageTheme;
  primaryColor: string;
  historyWindowDays: HistoryWindowDays;
  isPublished: boolean;
  groupNames: string[];
  assignment: Record<string, number>; // monitorId -> group index, or UNGROUPED. Absent = not on the page.
  order: string[]; // monitorIds in display order; relative order within a group is what's saved
};

function emptyForm(): FormState {
  return {
    name: '',
    slug: '',
    slugTouched: false,
    customDomain: '',
    description: '',
    logoUrl: '',
    theme: 'system',
    primaryColor: '#7c3aed',
    historyWindowDays: 90,
    isPublished: true,
    groupNames: [],
    assignment: {},
    order: [],
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function detailToForm(detail: StatusPageDetail): FormState {
  const groupNames = detail.groups.filter((g) => g.name !== null).map((g) => g.name as string);
  const assignment: Record<string, number> = {};
  const order: string[] = [];

  detail.groups.forEach((group) => {
    const index = group.name === null ? UNGROUPED : groupNames.indexOf(group.name);
    for (const monitorId of group.monitorIds) {
      assignment[monitorId] = index;
      order.push(monitorId);
    }
  });

  return {
    name: detail.name,
    slug: detail.slug,
    slugTouched: true,
    customDomain: detail.customDomain,
    description: detail.description,
    logoUrl: detail.logoUrl,
    theme: detail.theme,
    primaryColor: detail.primaryColor,
    historyWindowDays: detail.historyWindowDays,
    isPublished: detail.isPublished,
    groupNames,
    assignment,
    order,
  };
}

function formToGroups(form: FormState) {
  const groups: { name: string | null; monitorIds: string[] }[] = [
    { name: null, monitorIds: [] },
    ...form.groupNames.map((name) => ({ name, monitorIds: [] as string[] })),
  ];

  // Walk monitors in display order so each group's saved monitorIds keep the
  // order the user arranged them in; any assigned monitor missing from
  // `order` (shouldn't normally happen) is appended at the end.
  const orderedIds = [
    ...form.order.filter((id) => id in form.assignment),
    ...Object.keys(form.assignment).filter((id) => !form.order.includes(id)),
  ];

  for (const monitorId of orderedIds) {
    const index = form.assignment[monitorId];
    const bucket = index === UNGROUPED ? groups[0] : groups[index + 1];
    if (bucket) bucket.monitorIds.push(monitorId);
  }

  return groups;
}

function OverallStatusBadge({ status }: { status: StatusPageSummary['overallStatus'] }) {
  if (status === 'Outage') {
    return (
      <Badge
        variant="secondary"
        className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20 gap-1.5"
      >
        <XCircle className="h-3.5 w-3.5" />
        Major Outage
      </Badge>
    );
  }

  if (status === 'Degraded') {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Degraded
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      All Operational
    </Badge>
  );
}

export default function StatusPagesClientPage({ initialStatusPages, monitors }: StatusPagesClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const statusPagesQuery = useQuery({
    ...trpc.statusPage.getAll.queryOptions(),
    initialData: initialStatusPages,
  });
  const statusPages = statusPagesQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [publishFilter, setPublishFilter] = React.useState('all');

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    ...trpc.statusPage.getById.queryOptions({ id: editingId ?? '' }),
    enabled: editingId !== null,
  });

  React.useEffect(() => {
    if (detailQuery.data) setForm(detailToForm(detailQuery.data));
  }, [detailQuery.data]);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: trpc.statusPage.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const createPage = useMutation(
    trpc.statusPage.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updatePage = useMutation(
    trpc.statusPage.update.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const deletePage = useMutation(
    trpc.statusPage.delete.mutationOptions({ onSuccess: () => invalidateAll() }),
  );

  const togglePublish = useMutation(
    trpc.statusPage.togglePublish.mutationOptions({ onSuccess: () => invalidateAll() }),
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleNameChange = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      slug: prev.slugTouched ? prev.slug : slugify(name),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.slug) return;

    const payload = {
      name: form.name,
      slug: form.slug,
      customDomain: form.customDomain || undefined,
      description: form.description || undefined,
      logoUrl: form.logoUrl || undefined,
      theme: form.theme,
      primaryColor: form.primaryColor,
      historyWindowDays: form.historyWindowDays,
      isPublished: form.isPublished,
      groups: formToGroups(form),
    };

    if (editingId) {
      updatePage.mutate({ id: editingId, ...payload });
    } else {
      createPage.mutate(payload);
    }
  };

  const addGroup = () => setForm((prev) => ({ ...prev, groupNames: [...prev.groupNames, ''] }));

  const renameGroup = (index: number, name: string) =>
    setForm((prev) => {
      const groupNames = [...prev.groupNames];
      groupNames[index] = name;
      return { ...prev, groupNames };
    });

  const removeGroup = (index: number) =>
    setForm((prev) => {
      const groupNames = prev.groupNames.filter((_, i) => i !== index);
      const assignment = { ...prev.assignment };
      for (const [monitorId, groupIndex] of Object.entries(assignment)) {
        if (groupIndex === index) assignment[monitorId] = UNGROUPED;
        else if (groupIndex > index) assignment[monitorId] = groupIndex - 1;
      }
      return { ...prev, groupNames, assignment };
    });

  const assignMonitor = (monitorId: string, groupIndex: number) =>
    setForm((prev) => ({
      ...prev,
      assignment: { ...prev.assignment, [monitorId]: groupIndex },
      // Newly assigned monitors land at the end of their group; existing
      // members keep their spot in `order` so this doesn't reorder anyone.
      order: prev.order.includes(monitorId) ? prev.order : [...prev.order, monitorId],
    }));

  const removeMonitorFromPage = (monitorId: string) =>
    setForm((prev) => {
      const assignment = { ...prev.assignment };
      delete assignment[monitorId];
      return { ...prev, assignment, order: prev.order.filter((id) => id !== monitorId) };
    });

  const moveMonitorInGroup = (monitorId: string, direction: -1 | 1) =>
    setForm((prev) => {
      const groupIndex = prev.assignment[monitorId];
      if (groupIndex === undefined) return prev;

      const siblingIds = prev.order.filter((id) => prev.assignment[id] === groupIndex);
      const pos = siblingIds.indexOf(monitorId);
      const swapPos = pos + direction;
      if (pos === -1 || swapPos < 0 || swapPos >= siblingIds.length) return prev;

      const otherId = siblingIds[swapPos];
      const order = [...prev.order];
      const i1 = order.indexOf(monitorId);
      const i2 = order.indexOf(otherId);
      [order[i1], order[i2]] = [order[i2], order[i1]];

      return { ...prev, order };
    });

  const assignedMonitorGroups = React.useMemo(() => {
    const monitorsById = new Map(monitors.map((m) => [m.id, m] as const));
    const buckets: { index: number; name: string; monitors: Monitor[] }[] = [
      { index: UNGROUPED, name: 'Ungrouped', monitors: [] },
      ...form.groupNames.map((name, index) => ({ index, name: name || `Group ${index + 1}`, monitors: [] })),
    ];
    const bucketByIndex = new Map(buckets.map((b) => [b.index, b]));

    const orderedIds = [
      ...form.order.filter((id) => id in form.assignment),
      ...Object.keys(form.assignment).filter((id) => !form.order.includes(id)),
    ];

    for (const id of orderedIds) {
      const monitor = monitorsById.get(id);
      const bucket = bucketByIndex.get(form.assignment[id]);
      if (monitor && bucket) bucket.monitors.push(monitor);
    }

    return buckets.filter((b) => b.monitors.length > 0);
  }, [monitors, form.order, form.assignment, form.groupNames]);

  const unassignedMonitors = monitors.filter((m) => form.assignment[m.id] === undefined);

  const filteredPages = statusPages.filter((page) => {
    const matchesSearch =
      page.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      page.slug.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPublish =
      publishFilter === 'all' ||
      (publishFilter === 'published' && page.isPublished) ||
      (publishFilter === 'draft' && !page.isPublished);

    return matchesSearch && matchesPublish;
  });

  const handleCopyLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/status/${slug}`);
    } catch {
      // Clipboard access can be denied by the browser; nothing to recover from here.
    }
  };

  const isSaving = createPage.isPending || updatePage.isPending;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Status Pages</h1>
          <p className="text-sm text-muted-foreground">
            Create public status pages to communicate service availability.
          </p>
        </div>

        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Status Page
        </Button>
      </div>

      {/* Add/Edit Sheet */}
      <Sheet
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <SheetContent side="right" className="sm:max-w-xl w-full">
          <SheetHeader>
            <SheetTitle>{editingId ? 'Edit Status Page' : 'Create Status Page'}</SheetTitle>
            <SheetDescription>
              Configure what's shown at{' '}
              <span className="font-mono">/status/{form.slug || 'your-slug'}</span>
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-6">
              {/* Basics */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Basics</h3>
                <div className="grid gap-2">
                  <Label htmlFor="sp-name">Page Name</Label>
                  <Input
                    id="sp-name"
                    placeholder="e.g. Public Services Status"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sp-slug">Link</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground shrink-0">/status/</span>
                    <Input
                      id="sp-slug"
                      placeholder="my-company"
                      value={form.slug}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, slug: slugify(e.target.value), slugTouched: true }))
                      }
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sp-domain">Custom Domain (optional)</Label>
                  <Input
                    id="sp-domain"
                    placeholder="status.example.com"
                    value={form.customDomain}
                    onChange={(e) => setForm((prev) => ({ ...prev, customDomain: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Point a CNAME (or A record) at wherever this app is hosted, then enter the bare
                    domain here — no <span className="font-mono">https://</span> or path. TLS for the
                    domain is handled by your hosting/reverse proxy, not this app.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sp-description">Description (optional)</Label>
                  <Textarea
                    id="sp-description"
                    placeholder="A short description shown at the top of the page..."
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={2}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="sp-published">Published</Label>
                    <p className="text-xs text-muted-foreground">
                      Draft pages return a 404 on the public URL.
                    </p>
                  </div>
                  <Switch
                    id="sp-published"
                    checked={form.isPublished}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isPublished: checked }))}
                  />
                </div>
              </div>

              {/* Style */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Style</h3>
                <div className="grid gap-2">
                  <Label htmlFor="sp-logo">Logo URL (optional)</Label>
                  <Input
                    id="sp-logo"
                    placeholder="https://example.com/logo.png"
                    value={form.logoUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, logoUrl: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="sp-theme">Theme</Label>
                    <Select
                      value={form.theme}
                      onValueChange={(val) => {
                        if (val) setForm((prev) => ({ ...prev, theme: val as StatusPageTheme }));
                      }}
                    >
                      <SelectTrigger id="sp-theme">
                        <SelectValue>
                          {(val: StatusPageTheme) =>
                            ({ system: 'System', light: 'Light', dark: 'Dark' })[val]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="sp-color">Primary Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="sp-color"
                        type="color"
                        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                        value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : '#7c3aed'}
                        onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                      />
                      <Input
                        value={form.primaryColor}
                        onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sp-history">Uptime History</Label>
                  <Select
                    value={String(form.historyWindowDays)}
                    onValueChange={(val) => {
                      if (val) {
                        setForm((prev) => ({ ...prev, historyWindowDays: Number(val) as HistoryWindowDays }));
                      }
                    }}
                  >
                    <SelectTrigger id="sp-history">
                      <SelectValue>{(val: string) => `${val} days`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Groups */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Groups</h3>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addGroup}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Group
                  </Button>
                </div>
                {form.groupNames.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No groups yet — monitors will be shown in one flat list. Add a group to organize them
                    (e.g. "Core services", "Third-party dependencies").
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.groupNames.map((name, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          placeholder="Group name"
                          value={name}
                          onChange={(e) => renameGroup(index, e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => removeGroup(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Monitors */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Monitors</h3>
                  <p className="text-xs text-muted-foreground">
                    Use the arrows to set the order monitors appear in on the page.
                  </p>
                </div>
                {monitors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No monitors yet — create one on the Monitors page first.
                  </p>
                ) : (
                  <>
                    {assignedMonitorGroups.length > 0 && (
                      <div className="space-y-3">
                        {assignedMonitorGroups.map((bucket) => (
                          <div key={bucket.index} className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">{bucket.name}</p>
                            <div className="border rounded-lg divide-y">
                              {bucket.monitors.map((monitor, i) => (
                                <div key={monitor.id} className="flex items-center gap-2 p-2.5">
                                  <div className="flex flex-col shrink-0">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-4 w-6"
                                      disabled={i === 0}
                                      onClick={() => moveMonitorInGroup(monitor.id, -1)}
                                    >
                                      <ChevronUp className="h-3.5 w-3.5" />
                                      <span className="sr-only">Move up</span>
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-4 w-6"
                                      disabled={i === bucket.monitors.length - 1}
                                      onClick={() => moveMonitorInGroup(monitor.id, 1)}
                                    >
                                      <ChevronDown className="h-3.5 w-3.5" />
                                      <span className="sr-only">Move down</span>
                                    </Button>
                                  </div>
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="text-sm font-medium truncate">{monitor.name}</span>
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
                                      {monitor.type}
                                    </Badge>
                                  </div>
                                  <Select
                                    value={String(form.assignment[monitor.id] ?? UNGROUPED)}
                                    onValueChange={(val) => {
                                      if (val === null || val === undefined) return;
                                      if (val === REMOVE_FROM_PAGE) removeMonitorFromPage(monitor.id);
                                      else assignMonitor(monitor.id, Number(val));
                                    }}
                                  >
                                    <SelectTrigger className="w-40 shrink-0">
                                      <SelectValue>
                                        {(val: string) => {
                                          const index = Number(val);
                                          return index === UNGROUPED
                                            ? 'Ungrouped'
                                            : form.groupNames[index] || `Group ${index + 1}`;
                                        }}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={String(UNGROUPED)}>Ungrouped</SelectItem>
                                      {form.groupNames.map((name, index) => (
                                        <SelectItem key={index} value={String(index)}>
                                          {name || `Group ${index + 1}`}
                                        </SelectItem>
                                      ))}
                                      <SelectSeparator />
                                      <SelectItem value={REMOVE_FROM_PAGE}>Remove from page</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {unassignedMonitors.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Not on this page</p>
                        <div className="border rounded-lg divide-y">
                          {unassignedMonitors.map((monitor) => (
                            <div key={monitor.id} className="flex items-center justify-between gap-3 p-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{monitor.name}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
                                  {monitor.type}
                                </Badge>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1.5 shrink-0"
                                onClick={() => assignMonitor(monitor.id, UNGROUPED)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <div className="flex gap-2 w-full">
                <Button type="button" variant="outline" className="flex-1" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={isSaving}>
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Page'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Search Bar & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or link..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs defaultValue="all" value={publishFilter} onValueChange={setPublishFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({statusPages.length})</TabsTrigger>
            <TabsTrigger value="published">
              Published ({statusPages.filter((p) => p.isPublished).length})
            </TabsTrigger>
            <TabsTrigger value="draft">Draft ({statusPages.filter((p) => !p.isPublished).length})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Status Pages Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status Page</TableHead>
              <TableHead>System Status</TableHead>
              <TableHead>Monitors</TableHead>
              <TableHead>Subscribers</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No status pages found.
                </TableCell>
              </TableRow>
            ) : (
              filteredPages.map((page) => (
                <TableRow key={page.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{page.name}</span>
                      <a
                        href={`/status/${page.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        /status/{page.slug}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {page.customDomain && (
                        <a
                          href={`https://${page.customDomain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                        >
                          <Globe className="h-3 w-3 shrink-0" />
                          {page.customDomain}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <OverallStatusBadge status={page.overallStatus} />
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{page.monitorCount} monitors</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{page.subscriberCount}</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Switch
                      checked={page.isPublished}
                      onCheckedChange={(checked) => togglePublish.mutate({ id: page.id, isPublished: checked })}
                    />
                  </TableCell>

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
                          <DropdownMenuLabel>Options</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleCopyLink(page.slug)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Link
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(page.id)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deletePage.mutate({ id: page.id })}
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
