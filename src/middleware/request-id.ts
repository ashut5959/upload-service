import { randomUUID } from "crypto";

export const requestIdMiddleware = () => (ctx: any) => {
  const id = randomUUID();
  ctx.store.requestId = id;
  ctx.set.headers["x-request-id"] = id;
};
