// import pino from "pino";
// import fs from "fs";
// import path from "path";
// import pinoElastic from "pino-elasticsearch";
// import pinoRoll from "pino-roll";
// import { env } from "./env";

// // Create logs directory if it does not exist
// const logDir = path.join(process.cwd(), "logs");
// if (!fs.existsSync(logDir)) {
//   fs.mkdirSync(logDir, { recursive: true });
// }

// // Prepare transports based on environment
// let transport: any;

// // ----------------------
// // 🚀 Production Logging
// // ----------------------
// if (env.NODE_ENV === "production") {
//   // Elasticsearch transport
//   const elasticTransport = pino.transport({
//     target: "pino-elasticsearch",
//     options: {
//       node: env.ELASTICSEARCH_URL,
//       index: "upload-service-logs",
//       auth: {
//         username: env.ELASTIC_USERNAME,
//         password: env.ELASTIC_PASSWORD,
//       },
//       flushBytes: 1000,
//     },
//   });

//   // File rotation transport
//   const fileTransport = pinoRoll({
//     file: path.join(logDir, "app.log"),
//     frequency: "daily", // Rotate every day
//     size: "10m", // Max file size before rotate
//     mkdir: true,
//   });

//   // Combine both transports
//   transport = pino.transport({
//     targets: [
//       {
//         target: "pino-elasticsearch",
//         options: elasticTransport.options,
//         level: "info",
//       },
//       {
//         target: "pino-roll",
//         options: fileTransport.options,
//         level: "debug",
//       },
//     ],
//   });

//   // ----------------------
//   // 🛠 Development Logging
//   // ----------------------
// } else {
//   transport = pino.transport({
//     target: "pino-pretty",
//     options: { colorize: true },
//   });
// }

// // ----------------------
// // 🌟 Final Logger Instance
// // ----------------------
// export const logger = pino(
//   {
//     level: env.NODE_ENV === "production" ? "info" : "debug",
//     timestamp: pino.stdTimeFunctions.isoTime,
//   },
//   transport
// );

// import pino from "pino";
// import fs from "fs";
// import path from "path";
// import pinoElastic from "pino-elasticsearch";
// import pinoRoll from "pino-roll";
// import { env } from "./env";

// const streams: any[] = [];

// // Always log to stdout (Docker best practice)
// streams.push({ stream: process.stdout });

// // Production-only extras
// if (env.NODE_ENV === "production") {
//   // Elasticsearch (ONLY if URL exists)
//   if (env.ELASTICSEARCH_URL) {
//     streams.push({
//       stream: pinoElastic({
//         node: env.ELASTICSEARCH_URL,
//         index: "upload-service-logs",
//         auth: env.ELASTIC_USERNAME
//           ? {
//             username: env.ELASTIC_USERNAME,
//             password: env.ELASTIC_PASSWORD,
//           }
//           : undefined,
//       }),
//     });
//   }

//   // File logging
//   const logDir = path.join(process.cwd(), "logs");
//   fs.mkdirSync(logDir, { recursive: true });

//   streams.push({
//     stream: pinoRoll({
//       file: path.join(logDir, "app.log"),
//       frequency: "daily",
//       size: "10m",
//     }),
//   });
// }

// // Final logger
// export const logger = pino(
//   {
//     level: env.NODE_ENV === "production" ? "info" : "debug",
//     timestamp: pino.stdTimeFunctions.isoTime,
//   },
//   pino.multistream(streams)
// );

import pino from "pino";
import fs from "fs";
import path from "path";
import { env } from "./env";

const streams: { stream: NodeJS.WritableStream }[] = [];

// 1️⃣ Always log to stdout (Docker best practice)
streams.push({ stream: process.stdout });

// 2️⃣ File logging
const logDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logDir, { recursive: true });

const fileStream = fs.createWriteStream(
  path.join(logDir, "app.log"),
  { flags: "a" } // append mode
);

streams.push({ stream: fileStream });

// 3️⃣ Final logger
export const logger = pino(
  {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams)
);
