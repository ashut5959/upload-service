export const timerMiddleware = {
  before: (ctx: any) => {
    ctx.store.start = performance.now();
  },
};
