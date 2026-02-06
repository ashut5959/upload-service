export const sanitizer = {
  before: async (ctx: any) => {
    const dangerousPatterns = [
      /<script.*?>.*?<\/script>/gi,
      /(;|\||&|\$|\b(OR|AND)\b\s+\d+=\d+)/gi,
      /\$where|\$regex|\$gt|\$lt|\$eq/gi,
    ];

    if (ctx.body && typeof ctx.body === "object") {
      const cleanObject = (obj: any) => {
        for (const key in obj) {
          if (typeof obj[key] === "string") {
            dangerousPatterns.forEach((pat) => {
              obj[key] = obj[key].replace(pat, "");
            });
          } else if (typeof obj[key] === "object") {
            cleanObject(obj[key]);
          }
        }
      };

      cleanObject(ctx.body);
    }
  },
};
