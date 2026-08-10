import { z } from 'zod';
import { baseProcedure, createTRPCRouter } from '../init';

export const userRouter = createTRPCRouter({
  getAll: baseProcedure.query(async () => {
    return [{ id: '1', name: 'Kelvin' }];
  }),
  getById: baseProcedure
    .input(z.object({ id: z.string() }))
    .query(async (opts) => {
      return { id: opts.input.id, name: 'Kelvin' };
    }),
});