// Read-only: tags themselves have no dedicated create/edit UI. They're
// created implicitly (find-or-create by name) whenever a monitor is saved
// with a tag name that doesn't exist yet — see monitor.ts's `applyTags`.
// This router just powers the tag-input's autocomplete suggestions in the
// monitor form.
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';

export type TagSummary = { id: string; name: string; color: string };

export const tagRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async (): Promise<TagSummary[]> => {
    return prisma.tag.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true },
    });
  }),
});
