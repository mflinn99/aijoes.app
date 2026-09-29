import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setStorageUser } from "@/lib/userScope";
import { PageMetadata } from "@/components/PageMetadata";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import Boardroom from "@/pages/boardroom";
import Analysis from "@/pages/analysis";
import DecisionLog from "@/pages/decision-log";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/boardroom" component={Boardroom} />
      <Route path="/analysis" component={Analysis} />
      <Route path="/log" component={DecisionLog} />
      <Route path="/reset-password">
        <Redirect to="/" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Public access never adopts an existing Supabase session or reads its data.
  // Keep historical per-account storage untouched for possible future access.
  setStorageUser(null);

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <PageMetadata />
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
