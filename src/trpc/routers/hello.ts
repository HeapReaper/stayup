import { z } from 'zod';
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../init';

/**
 * Example procedure
 */
export const helloRouter = createTRPCRouter({
  world: baseProcedure // Or protectedProcedure, which only allow logged in users to access
    .input(
      z.object({
        text: z.string(),
      }),
    )
    .query((opts) => {
      return {
        greeting: `Hello ${opts.input.text}`,
      };
    }),
});