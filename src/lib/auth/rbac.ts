/**
 * Role-based access control — Directive §24.
 *
 * Roles were declared in iteration 1 but never enforced. This is the matrix,
 * and it is the only place permissions are decided.
 *
 * The separation that matters: MSP_USER can do the work — analyse, plan, run,
 * and stop. Only MSP_ADMIN can *authorise* a plan or approve a gate, because
 * those are the decisions that commit money and reach a customer. Halting is
 * deliberately available to anyone who can act: an emergency stop that needs an
 * administrator is not an emergency stop.
 */

export type Role = 'PLATFORM_ADMIN' | 'MSP_ADMIN' | 'MSP_USER' | 'READ_ONLY';

export type Permission =
  | 'read'
  | 'analyse'
  | 'execute'
  | 'halt'
  | 'authorise'
  | 'administer'
  | 'platform';

const MATRIX: Record<Role, Permission[]> = {
  READ_ONLY: ['read'],
  MSP_USER: ['read', 'analyse', 'execute', 'halt'],
  MSP_ADMIN: ['read', 'analyse', 'execute', 'halt', 'authorise', 'administer'],
  PLATFORM_ADMIN: ['read', 'analyse', 'execute', 'halt', 'authorise', 'administer', 'platform'],
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  READ_ONLY: 'View analysis, opportunities and reporting. Cannot change anything.',
  MSP_USER: 'Run analysis, create and run execution plans, and stop them. Cannot authorise.',
  MSP_ADMIN: 'Everything an MSP user can do, plus authorising plans, approving gates, granting autonomy and managing users.',
  PLATFORM_ADMIN: 'AIGoGo platform operations across tenants.',
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export class ForbiddenError extends Error {
  constructor(
    readonly permission: Permission,
    readonly role: Role,
  ) {
    super(`Role ${role} does not hold the "${permission}" permission.`);
    this.name = 'ForbiddenError';
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission, role);
}
