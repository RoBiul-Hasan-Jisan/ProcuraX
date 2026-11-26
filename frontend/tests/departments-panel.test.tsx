import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
import { DepartmentsPanel } from "@/features/settings/DepartmentsPanel";

const depts = [{ _id: "d1", code: "PROD", name: "Production", active: true }, { _id: "d2", code: "OLD", name: "Old Dept", active: false }];
beforeEach(() => { apiFetch.mockReset(); apiFetch.mockImplementation(async () => ({ data: depts })); });

describe("DepartmentsPanel", () => {
  it("lists active and inactive departments", async () => {
    render(<DepartmentsPanel />);
    expect(await screen.findByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/departments?all=1");
  });
  it("creates a department with an upper-cased code", async () => {
    render(<DepartmentsPanel />);
    await screen.findByText("Production");
    await userEvent.type(screen.getByLabelText("Department code"), "qa");
    await userEvent.type(screen.getByLabelText("Department name"), "Quality Assurance");
    await userEvent.click(screen.getByRole("button", { name: "Add department" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/departments", { method: "POST", body: JSON.stringify({ code: "QA", name: "Quality Assurance" }) }));
  });
  it("deactivates instead of deleting", async () => {
    render(<DepartmentsPanel />);
    await screen.findByText("Production");
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/departments/d1", { method: "PATCH", body: JSON.stringify({ active: false }) }));
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
  it("shows the server error", async () => {
    render(<DepartmentsPanel />);
    await screen.findByText("Production");
    apiFetch.mockRejectedValueOnce(new Error("A department with this code already exists"));
    await userEvent.type(screen.getByLabelText("Department code"), "PROD");
    await userEvent.type(screen.getByLabelText("Department name"), "Dup");
    await userEvent.click(screen.getByRole("button", { name: "Add department" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});
