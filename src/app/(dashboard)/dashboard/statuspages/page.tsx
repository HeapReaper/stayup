'use client';

import * as React from 'react';
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
  Lock,
  Eye,
  Activity,
  Copy,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Type definition for a Status Page
type StatusPage = {
  id: string;
  name: string;
  slug: string;
  customDomain?: string;
  visibility: 'Public' | 'Private' | 'Password Protected';
  status: 'All Operational' | 'Degraded' | 'Major Outage';
  monitorsCount: number;
  isPublished: boolean;
  createdAt: string;
};

// Mock data
const initialStatusPages: StatusPage[] = [
  {
    id: '1',
    name: 'Public Platform Status',
    slug: 'status.mycompany.com',
    customDomain: 'status.mycompany.com',
    visibility: 'Public',
    status: 'All Operational',
    monitorsCount: 6,
    isPublished: true,
    createdAt: '2026-01-10',
  },
  {
    id: '2',
    name: 'Internal Developer Services',
    slug: 'internal-dev-status',
    visibility: 'Private',
    status: 'Degraded',
    monitorsCount: 12,
    isPublished: true,
    createdAt: '2026-03-04',
  },
  {
    id: '3',
    name: 'Enterprise Client Portal',
    slug: 'enterprise-status',
    visibility: 'Password Protected',
    status: 'All Operational',
    monitorsCount: 4,
    isPublished: false,
    createdAt: '2026-05-18',
  },
];

export default function StatusPagesPage() {
  const [statusPages, setStatusPages] = React.useState<StatusPage[]>(initialStatusPages);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [visibilityFilter, setVisibilityFilter] = React.useState('all');
  const [isAddOpen, setIsAddOpen] = React.useState(false);

  // Form state for new status page
  const [newPage, setNewPage] = React.useState({
    name: '',
    slug: '',
    customDomain: '',
    visibility: 'Public' as StatusPage['visibility'],
  });

  // Filter by search query & visibility tab
  const filteredPages = statusPages.filter((page) => {
    const matchesSearch =
      page.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      page.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (page.customDomain && page.customDomain.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesVisibility =
      visibilityFilter === 'all' ||
      page.visibility.toLowerCase().replace(' ', '-') === visibilityFilter;

    return matchesSearch && matchesVisibility;
  });

  // Create new status page
  const handleAddPage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPage.name || !newPage.slug) return;

    const created: StatusPage = {
      id: Date.now().toString(),
      name: newPage.name,
      slug: newPage.slug.toLowerCase().replace(/\s+/g, '-'),
      customDomain: newPage.customDomain || undefined,
      visibility: newPage.visibility,
      status: 'All Operational',
      monitorsCount: 0,
      isPublished: true,
      createdAt: new Date().toISOString().split('T')[0],
    };

    setStatusPages([created, ...statusPages]);
    setNewPage({ name: '', slug: '', customDomain: '', visibility: 'Public' });
    setIsAddOpen(false);
  };

  // Toggle published status
  const handleTogglePublish = (id: string, currentVal: boolean) => {
    setStatusPages(
      statusPages.map((page) =>
        page.id === id ? { ...page, isPublished: !currentVal } : page
      )
    );
  };

  // Delete status page
  const handleDeletePage = (id: string) => {
    setStatusPages(statusPages.filter((page) => page.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Status Pages</h1>
          <p className="text-sm text-muted-foreground">
            Create public and internal status pages to communicate service availability.
          </p>
        </div>

        {/* Modal for New Status Page */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Status Page
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[485px]">
            <form onSubmit={handleAddPage}>
              <DialogHeader>
                <DialogTitle>Create New Status Page</DialogTitle>
                <DialogDescription>
                  Give your page a name and choose a unique slug or custom domain.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Page Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Public Services Status"
                    value={newPage.name}
                    onChange={(e) => setNewPage({ ...newPage, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slug">URL Slug</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground shrink-0">status.app/</span>
                    <Input
                      id="slug"
                      placeholder="my-company"
                      value={newPage.slug}
                      onChange={(e) => setNewPage({ ...newPage, slug: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="domain">Custom Domain (Optional)</Label>
                  <Input
                    id="domain"
                    placeholder="status.mycompany.com"
                    value={newPage.customDomain}
                    onChange={(e) => setNewPage({ ...newPage, customDomain: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="visibility">Visibility</Label>
                  <Select
                    value={newPage.visibility}
                    onValueChange={(val: StatusPage['visibility']) =>
                      setNewPage({ ...newPage, visibility: val })
                    }
                  >
                    <SelectTrigger id="visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Public">Public (Everyone)</SelectItem>
                      <SelectItem value="Private">Private (Team members only)</SelectItem>
                      <SelectItem value="Password Protected">Password Protected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create & Configure</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, slug, or domain..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs defaultValue="all" value={visibilityFilter} onValueChange={setVisibilityFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({statusPages.length})</TabsTrigger>
            <TabsTrigger value="public">Public</TabsTrigger>
            <TabsTrigger value="private">Private</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Status Pages Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status Page</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>System Status</TableHead>
              <TableHead>Monitors</TableHead>
              <TableHead>Active</TableHead>
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
                  {/* Name & URL / Domain */}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{page.name}</span>
                      <a
                        href={`https://${page.customDomain || `${page.slug}.status.app`}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        {page.customDomain || `status.app/${page.slug}`}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  </TableCell>

                  {/* Visibility Badge */}
                  <TableCell>
                    <Badge variant="outline" className="gap-1.5 font-normal">
                      {page.visibility === 'Public' && <Eye className="h-3 w-3 text-emerald-500" />}
                      {page.visibility === 'Private' && <Lock className="h-3 w-3 text-amber-500" />}
                      {page.visibility === 'Password Protected' && <Lock className="h-3 w-3 text-blue-500" />}
                      {page.visibility}
                    </Badge>
                  </TableCell>

                  {/* System Status */}
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        page.status === 'All Operational'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5'
                      }
                    >
                      {page.status === 'All Operational' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {page.status}
                    </Badge>
                  </TableCell>

                  {/* Connected Monitors */}
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{page.monitorsCount} monitors</span>
                    </div>
                  </TableCell>

                  {/* Published Switch */}
                  <TableCell>
                    <Switch
                      checked={page.isPublished}
                      onCheckedChange={() => handleTogglePublish(page.id, page.isPublished)}
                    />
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
                          <DropdownMenuLabel>Options</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => alert(`URL copied to clipboard!`)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy URL
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alert(`Edit ${page.name}`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeletePage(page.id)}
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