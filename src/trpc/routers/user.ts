import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';

export const userRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    return await prisma.user.findMany();
  }),
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async (opts) => {
      return await prisma.user.findFirst({
        where: {
          id: opts.input.id
        }
      });
    }),
});