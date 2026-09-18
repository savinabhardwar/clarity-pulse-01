interface Env {
  FEATURE_FLAGS: KVNamespace;
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const status = (await env.FEATURE_FLAGS.get("status")) ?? "(no 'status' key set in KV)";
    return new Response(`ai-pm-platform hello-world: ${status}`);
  },
};
