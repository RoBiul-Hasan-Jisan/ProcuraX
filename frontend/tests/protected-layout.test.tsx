import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/overview",
}));

const authState: Record<string, unknown> = {};
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => authState }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div> }));

import ProtectedLayout from "@/app/(app)/layout";

const set = (s: Record<string, unknown>) => {
  Object.keys(authState).forEach((k) => delete authState[k]);
  Object.assign(authState, { refresh: vi.fn(), signOut: vi.fn(), error: null, permissions: [], can: () => true }, s);
};

describe("protected routes", () => {
  beforeEach(() => { replace.mockClear(); });

  it("redirects signed-out visitors to /login", () => {
    set({ status: "signed_out", user: null });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("shows a loading state while the session loads", () => {
    set({ status: "loading", user: null });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state with retry when the API fails", () => {
    set({ status: "error", user: null, error: "Cannot reach the ProcuraX API." });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot reach");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("blocks pending accounts", () => {
    set({ status: "ready", user: { status: "pending" } });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("blocks suspended accounts", () => {
    set({ status: "ready", user: { status: "suspended" } });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(screen.getByText("Account suspended")).toBeInTheDocument();
  });

  it("renders the app for active accounts", () => {
    set({ status: "ready", user: { status: "active" } });
    render(<ProtectedLayout>secret</ProtectedLayout>);
    expect(screen.getByTestId("shell")).toHaveTextContent("secret");
  });
});
