import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signed_out" }) }));
const loginWithEmail = vi.fn();
vi.mock("@/lib/firebase/auth", () => ({
  loginWithEmail: (...a: unknown[]) => loginWithEmail(...a),
  loginWithGoogle: vi.fn(),
  friendlyAuthError: (e: unknown) => (e as Error).message,
}));

import LoginPage from "@/app/(auth)/login/page";

describe("login form", () => {
  beforeEach(() => { loginWithEmail.mockReset(); });

  it("validates required fields before calling Firebase", async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(loginWithEmail).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
  });

  it("submits valid credentials", async () => {
    loginWithEmail.mockResolvedValue({});
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(loginWithEmail).toHaveBeenCalledWith("a@b.co", "secret123"));
  });

  it("shows a friendly error when sign-in fails", async () => {
    loginWithEmail.mockImplementation(() => Promise.reject(new Error("Incorrect email or password.")));
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });
});
