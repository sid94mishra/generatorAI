import type { UseMutationOptions } from '@tanstack/react-query';

/** Presentation effects supplied by screens; request/cache behavior stays in query hooks. */
export type MutationCallbacks<Data, Variables = void, Context = unknown> = Pick<
  UseMutationOptions<Data, Error, Variables, Context>,
  'onSuccess' | 'onError' | 'onSettled'
>;
