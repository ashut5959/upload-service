import RedisClient from "@/clients/redis.client";
import crypto from "crypto";

export const redisLock = async (key: string, fn: Function, ttl = 15000) => {
  const redis = RedisClient.getInstance();
  const token = crypto.randomUUID();

  const acquired = await redis.set(key, token, "PX", ttl, "NX");
  if (!acquired) throw new Error("LOCK_NOT_ACQUIRED");

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
