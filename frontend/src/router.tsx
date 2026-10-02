import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // This dashboard's data refreshes once a day via the scheduled
        // Jira sync, so treat anything fetched in the last few minutes as
        // fresh -- without this every navigation/window refocus refetched
        // every view and RPC, flashing loading spinners on each page visit.
        staleTime: 5 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        // Supabase errors here are almost always RLS/config problems that
        // a retry won't fix; one retry covers transient pooler blips.
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
