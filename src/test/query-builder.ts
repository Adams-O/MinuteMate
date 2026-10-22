export type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type FakeQuery = {
  select: (...args: unknown[]) => FakeQuery;
  insert: (...args: unknown[]) => FakeQuery;
  update: (...args: unknown[]) => FakeQuery;
  delete: (...args: unknown[]) => FakeQuery;
  eq: (...args: unknown[]) => FakeQuery;
  is: (...args: unknown[]) => FakeQuery;
  in: (...args: unknown[]) => FakeQuery;
  lt: (...args: unknown[]) => FakeQuery;
  lte: (...args: unknown[]) => FakeQuery;
  gt: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  then: <TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

export function createQuery(result: QueryResult): FakeQuery {
  const query = {} as FakeQuery;
  const chain = () => query;
  const then: FakeQuery["then"] = (onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled, onrejected);

  Object.assign(query, {
    select: chain,
    insert: chain,
    update: chain,
    delete: chain,
    eq: chain,
    is: chain,
    in: chain,
    lt: chain,
    lte: chain,
    gt: chain,
    order: chain,
    limit: chain,
    maybeSingle: async () => result,
    single: async () => result,
    then,
  });

  return query;
}
