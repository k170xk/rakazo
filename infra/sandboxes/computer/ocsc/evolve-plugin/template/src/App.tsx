import { AlertCircle, Home, Info } from "lucide-react";
import { useEffect, useState } from "react";
import type { EvolveContext, Person } from "./evolve";
import { evolve } from "./evolve";
import type { NavItem } from "./ui";
import {
  AppShell,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
  TopNav,
} from "./ui";

// The plugin's sections go in this top menu. Never add a side menu: Evolve's own is beside it.
const NAV: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "about", label: "About", icon: Info },
];

export default function App() {
  const [context, setContext] = useState<EvolveContext | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState("home");

  useEffect(() => {
    evolve
      .ready()
      .then(async (ctx) => {
        setContext(ctx);
        setMe(await evolve.call("me.read"));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error)
    return (
      <AppShell>
        <EmptyState icon={AlertCircle} title="Something went wrong">
          {error}
        </EmptyState>
      </AppShell>
    );
  if (!context)
    return (
      <AppShell>
        <Spinner />
      </AppShell>
    );

  return (
    <AppShell nav={<TopNav items={NAV} active={page} onSelect={setPage} />}>
      {page === "home" ? (
        <>
          <PageHeader
            title={context.plugin.name}
            description={`Hello ${me?.full_name ?? context.user.name ?? "there"}.`}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start here</CardTitle>
              <CardDescription>
                Replace this page with the plugin. Data comes only from evolve.call.
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      ) : (
        <>
          <PageHeader title="About" description="What this plugin does and who to ask about it." />
          <Card>
            <CardContent className="pt-6 text-sm">Version {context.plugin.version}</CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
