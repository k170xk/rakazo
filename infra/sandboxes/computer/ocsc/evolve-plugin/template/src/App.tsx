import { useEffect, useState } from "react";
import type { EvolveContext, Person } from "./evolve";
import { evolve } from "./evolve";

export default function App() {
  const [context, setContext] = useState<EvolveContext | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <main className="page">
        <p className="error">{error}</p>
      </main>
    );
  if (!context)
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );

  return (
    <main className="page">
      <h1>{context.plugin.name}</h1>
      <p className="muted">Hello {me?.full_name ?? context.user.name ?? "there"}.</p>
      <section className="card">
        <p>Replace this page with the plugin. Data comes only from evolve.call.</p>
      </section>
    </main>
  );
}
