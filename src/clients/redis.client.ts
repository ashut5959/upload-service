import Redis from "ioredis";
import { env } from "@/utils/env";

export default class RedisClient {
  private static instance: Redis;

  static getInstance() {
    if (!this.instance) this.instance = new Redis(env.REDIS_URL);
    return this.instance;
  }
}
