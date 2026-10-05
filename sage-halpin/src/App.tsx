import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageMetadata } from "@/components/PageMetadata";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import Boardroom from "@/pages/boardroom";
import Analysis from "@/pages/analysis";
import DecisionLog from "@/pages/decision-log";
import OrganisationPage from "@/pages/organisation";
import { QuestionList, NewQuestion } from "@/pages/questions";
import QuestionRoom from "@/pages/question-room";
import Respond from "@/pages/respond";
import AgentsPage from "@/pages/agents";
import HorizonPage from "@/pages/horizon";
import CheckpointPage from "@/pages/checkpoint";
import NotFound from "@/pages/not-found";
import { SignInPage, SignUpPage } from "@/pages/auth";
import { AccountProvider } from "@/components/AccountProvider";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/boardroom" component={Boardroom} />
      <Route path="/analysis" component={Analysis} />
      <Route path="/log" component={DecisionLog} />
      <Route path="/organisation" component={OrganisationPage} />
      <Route path="/questions" component={QuestionList} />
      <Route path="/questions/new" component={NewQuestion} />
      <Route path="/questions/:id" component={QuestionRoom} />
      <Route path="/respond/:token" component={Respond} />
      <Route path="/signin" component={SignInPage} />
      <Route path="/signup" component={SignUpPage} />
      <Route path="/agents" component={AgentsPage} />
      <Route path="/horizon" component={HorizonPage} />
      <Route path="/checkpoint" component={CheckpointPage} />
      <Route path="/reset-password">
        <Redirect to="/" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <PageMetadata />
        <AccountProvider>
          <Router />
        </AccountProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
