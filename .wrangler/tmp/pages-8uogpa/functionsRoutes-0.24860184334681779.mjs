import { onRequestPost as __api_e_ts_onRequestPost } from "/Users/yurgon/projects/pdf_converter/functions/api/e.ts"
import { onRequest as __api_e_ts_onRequest } from "/Users/yurgon/projects/pdf_converter/functions/api/e.ts"

export const routes = [
    {
      routePath: "/api/e",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_e_ts_onRequestPost],
    },
  {
      routePath: "/api/e",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_e_ts_onRequest],
    },
  ]