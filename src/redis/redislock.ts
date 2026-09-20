import RedisClient from "@/clients/redis.client";
import crypto from "crypto";
import { ConflictError } from "@/utils/app-error";

export const redisLock = async (key: string, fn: Function, ttl = 15000) => {
  const redis = RedisClient.getInstance();
  const token = crypto.randomUUID();

  const acquired = await redis.set(key, token, "PX", ttl, "NX");
  if (!acquired)
    throw new ConflictError("This upload is already being processed, try again shortly");

  try {
    return await fn();
  } finally {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1]
      then return redis.call("del", KEYS[1])
      else return 0 end
    `;

    await redis.eval(script, 1, key, token);
  }
};
