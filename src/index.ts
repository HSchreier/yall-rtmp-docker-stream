import { bootstrap } from "./bootstrap.ts";

const app = await bootstrap();
app.logger.info(
  { httpPort: app.config.get().httpPort, mongoConnected: app.mongo.isConnected() },
  "sidecar bootstrapped (partial slice)",
);
