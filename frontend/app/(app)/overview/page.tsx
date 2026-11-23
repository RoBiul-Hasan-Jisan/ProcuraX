"use client";

import { Building2, RefreshCw, UserCheck, UserCog, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { ROLE_OPTIONS } from "@/types";

interface Overview {
  organisation: {
    activeDepartments: number;
    users: { total: number; active: number; pending: number; suspended: number };
    activeUsersByRole: Record<string, number>;
  };
  procurementKpis: { available: boolean; reason?: string };
  generatedAt: string;
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="rounded-md bg-steel-100 p-2 text-steel-600"><Icon className="h-5 w-5" /></div>
      <div>
        <div className="text-2xl font-semibold text-navy-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}

function ExecutiveOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // setState only happens inside promise callbacks (after the request resolves).
  useEffect(() => {
    let active = true;
    const run = () =>
      apiFetch<Overview>("/dashboard/overview")
        .then((res) => {
          if (!active) return;
          setData(res.data);
          setError(null);
        })
        .catch((e: unknown) => {
          if (active) setError(e instanceof Error ? e.message : "Failed to load overview");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void run();
    const timer = setInterval(() => void run(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reloadKey]);

  const refresh = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  if (loading && !data) return <LoadingState label="Loading overview…" />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const { organisation: org } = data;
  const roleLabel = new Map(ROLE_OPTIONS.map((r) => [r.value as string, r.label]));
  const chart = Object.entries(org.activeUsersByRole).map(([role, count]) => ({
    role: roleLabel.get(role) ?? role,
    count,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-navy-900">Overview</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-danger">Refresh failed: {error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active departments" value={org.activeDepartments} icon={Building2} />
        <Kpi label="Registered users" value={org.users.total} icon={Users} />
        <Kpi label="Active users" value={org.users.active} icon={UserCheck} />
        <Kpi label="Accounts awaiting approval" value={org.users.pending} icon={UserCog} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Active users by role" />
          <div className="h-64 p-4">
            {chart.length === 0 ? (
              <EmptyState message="No active users with roles yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9dfe7" />
                  <XAxis dataKey="role" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2f5d92" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Procurement KPIs" />
          <div className="p-4 text-sm text-slate-600">
            {data.procurementKpis.available ? null : (
              <>
                <p className="font-medium text-navy-900">Not available yet</p>
                <p className="mt-1">{data.procurementKpis.reason}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Spending, inventory value, supplier performance and the other KPIs will appear here as live
                  database figures once those modules exist. No placeholder numbers are shown.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function WorkspaceHome() {
  const { user, permissions } = useAuth();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-navy-900">Welcome, {user?.displayName}</h1>
      <Card className="p-4 text-sm text-slate-600">
        <p>
          Signed in as <strong>{user?.roleLabel}</strong>. Your workspace modules are delivered in later phases
          (for suppliers: RFQs, quotations and purchase orders arrive in Phase 2-3).
        </p>
        <p className="mt-2 text-xs text-slate-500">{permissions.length} permissions granted by your role.</p>
      </Card>
    </div>
  );
}

export default function OverviewPage() {
  const { can } = useAuth();
  return can("dashboard:view") ? <ExecutiveOverview /> : <WorkspaceHome />;
}
