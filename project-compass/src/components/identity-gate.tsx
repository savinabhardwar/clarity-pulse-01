import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getIdentity, isValidEmail, setIdentity } from "@/lib/stakeholder-types";

// Self-declared identity gate -- no auth exists anywhere in this monorepo,
// so this is a one-time "who are you" prompt, not a security boundary.
// Blocks rendering the app until a name + a plausible-looking email are
// entered; the result is used everywhere identity matters (item creation,
// audit-trail attribution, comment authorship).
export function IdentityGate({ children }: { children: ReactNode }) {
  // Starts null on both server and client (localStorage doesn't exist
  // during SSR) so the first client render matches the server-rendered
  // HTML exactly -- the real value is read after mount instead, avoiding a
  // hydration mismatch for anyone who already has an identity stored.
  const [identity, setIdentityState] = useState<ReturnType<typeof getIdentity>>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIdentityState(getIdentity());
  }, []);

  if (identity) return <>{children}</>;

  function submit() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    const next = { name: trimmedName, email: trimmedEmail };
    setIdentity(next);
    setIdentityState(next);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-panel">
        <div className="space-y-1.5 text-center">
          <h1 className="text-lg font-semibold">Stakeholder Management</h1>
          <p className="text-sm text-muted-foreground">
            Enter your name and email to continue. This identifies your comments and changes to
            others viewing this dashboard.
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="identity-name">Name</Label>
            <Input
              id="identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="identity-email">Email</Label>
            <Input
              id="identity-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane.doe@company.com"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <Button onClick={submit} className="w-full">
          Continue
        </Button>
      </div>
    </div>
  );
}
