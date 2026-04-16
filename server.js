// server.js - Bull Board dashboard server

import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import config from "./src/config.js";

const app = express();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(config.dashboard.path);

// Import queue here to avoid circular dependency
const { notificationQueue } = await import("./queue.js");

createBullBoard({
  queues: [new BullMQAdapter(notificationQueue)],
  serverAdapter: serverAdapter,
});

app.use(config.dashboard.path, serverAdapter.getRouter());

app.listen(config.dashboard.port, () => {
  console.log(
    `[server] Bull Board dashboard at http://localhost:${config.dashboard.port}${config.dashboard.path}`,
  );
});

export default app;
