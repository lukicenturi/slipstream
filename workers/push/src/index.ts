import { handleRequest } from "./api";
import type { Env } from "./env";
import { runTick } from "./watch";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runTick(env).catch((error: unknown) => {
        console.log(JSON.stringify({ event: "tick_error", message: String(error) }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
