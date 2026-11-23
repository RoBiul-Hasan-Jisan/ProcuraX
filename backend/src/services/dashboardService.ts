import { User } from '../models/User';
import { Department } from '../models/Department';

/**
 * Phase 1 dashboard foundation: real counts from MongoDB.
 * Procurement/inventory KPIs are added as their collections are built in later phases;
 * until then they are reported as `available: false` instead of showing fake numbers.
 */
export async function getOverview() {
  const [userStatus, userRoles, departments] = await Promise.all([
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    Department.countDocuments({ active: true }),
  ]);

  const byStatus = Object.fromEntries(userStatus.map((r) => [r._id, r.count as number]));
  const byRole = Object.fromEntries(userRoles.map((r) => [r._id ?? 'unassigned', r.count as number]));

  return {
    organisation: {
      activeDepartments: departments,
      users: {
        total: (Object.values(byStatus) as number[]).reduce((a, b) => a + b, 0),
        active: byStatus.active ?? 0,
        pending: byStatus.pending ?? 0,
        suspended: byStatus.suspended ?? 0,
      },
      activeUsersByRole: byRole,
    },
    procurementKpis: {
      available: false,
      reason: 'Procurement, inventory and supplier modules are delivered in Phases 2-3.',
    },
    generatedAt: new Date().toISOString(),
  };
}
