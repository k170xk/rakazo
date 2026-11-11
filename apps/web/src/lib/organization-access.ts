import type { OrganizationList } from "@rakazo/contracts";

type Organization = OrganizationList["organizations"][number];

/**
 * Its manager may delete a work space unless it is the permanent company one or the last they
 * manage, so nobody is left without a work space of their own.
 */
export function canDeleteOrganization(
  organization: Organization,
  organizations: Organization[],
): boolean {
  return (
    organization.canManage &&
    !organization.permanent &&
    organizations.filter((each) => each.canManage).length > 1
  );
}
