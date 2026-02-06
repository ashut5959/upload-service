export const bodyLimit = (maxSize: number = 1024 * 1024) => ({
  before: async (ctx: any) => {
    const len = Number(ctx.request.headers.get("content-length") || 0);
    if (len > maxSize) {
      return new Response("Payload too large", { status: 413 });
    }
  },
});
