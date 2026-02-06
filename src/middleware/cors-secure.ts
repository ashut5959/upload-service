import { logger } from "@/utils/logger";
import { Elysia } from "elysia";

export const secureCors = ({
  allowedOrigins = [],
  methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders = "Content-Type, Authorization, X-Requested-With",
}: {
  allowedOrigins?: string[];
  methods?: string[];
  allowHeaders?: string;
}) =>
  new Elysia({ name: "secure-cors" })
    // 1️⃣ Handle ALL OPTIONS requests globally
    .options("*", ({ request }) => {
      const origin = request.headers.get("origin") ?? "";

      logger.info({ msg: "CORS check", origin, allowedOrigins });

      // If origin not allowed, reject
      if (origin && !allowedOrigins.includes(origin)) {
        return new Response("CORS Origin Not Allowed", { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": methods.join(","),
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": allowHeaders,
          Vary: "Origin",
        },
      });
    })
    .onBeforeHandle(({ request, set }) => {
      const origin = request.headers.get("origin") || "";

      logger?.info?.({ msg: "CORS check for non-options", origin, allowedOrigins });

      // if origin present and not allowed -> reject
      if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
        return new Response("CORS Origin Not Allowed", { status: 403 });
      }

      // For credentialed requests, we must echo back the origin (no "*")
      const allowOrigin = origin || (allowedOrigins.length === 1 ? allowedOrigins[0] : "");

      const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": allowOrigin ?? "",
        "Access-Control-Allow-Methods": methods.join(","),
        "Access-Control-Allow-Headers": allowHeaders,
        "Access-Control-Allow-Credentials": "true", // required when credentials: "include"
        Vary: "Origin",
      };

      // Preflight: respond immediately with CORS headers
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }

      // For normal requests, ensure these headers are present on response
      Object.assign(set.headers, headers);
    })

    // 2️⃣ Apply CORS headers to ALL non-OPTIONS requests
    .onAfterHandle(({ set, request }) => {
      if (!request.headers.get("origin")) return;

      if (!set.headers["Access-Control-Allow-Origin"]) {
        set.headers["Access-Control-Allow-Origin"] = request.headers.get("origin")!;
        set.headers["Access-Control-Allow-Credentials"] = "true";
        set.headers["Access-Control-Allow-Headers"] =
          "Content-Type, Authorization, X-Requested-With";
      }
    });
