# SaleSonic Enterprise — verified permission matrix

Source of truth for the persona guides. Every row below was read out of the
server code, not inferred from the interface, because the interface hides
controls a determined user could still reach.

Roles: Sales Person, Sales Manager, Sales Director, Tenant Admin, Platform
Admin. Platform Admin is an operator role held by AIGoGo, never by a customer.

## Pipeline

| Action | Sales Person | Sales Manager | Sales Director | Tenant Admin |
|---|---|---|---|---|
| See deals where they are account manager | Yes | Yes | Yes | Yes |
| See other people's deals | **No** | Yes | Yes | Yes |
| Create a deal | Own only | Any | Any | Any |
| Edit a deal | Own only | Any | Any | Any |
| Reassign a deal to someone else | **No** | Yes | Yes | Yes |
| Delete a deal | **No** | Yes | Yes | Yes |
| Manage contacts and activity on a visible deal | Yes | Yes | Yes | Yes |

A Sales Person asking for another rep's deal by its direct address is told the
deal does not exist, rather than that they may not see it — so the pipeline
cannot be mapped by guessing.

## Commercial DNA and settings

| Action | Sales Person | Sales Manager | Sales Director | Tenant Admin |
|---|---|---|---|---|
| View Commercial DNA | Yes | Yes | Yes | Yes |
| Edit Commercial DNA | No | No | No | **Yes** |
| Run the setup wizard | No | No | No | **Yes** |

## People

| Action | Sales Person | Sales Manager | Sales Director | Tenant Admin |
|---|---|---|---|---|
| See colleagues and their roles | No | No | No | **Yes** |
| Invite a colleague | No | No | No | **Yes** |
| Change someone's role | No | No | No | **Yes** |
| Deactivate or reactivate someone | No | No | No | **Yes** |
| Create a Platform Admin | No | No | No | **No — nobody can** |

A tenant can never be left without at least one active Tenant Admin. A
deactivated person cannot sign in and their existing sessions stop working at
once, but the deals they owned stay visible to managers and directors, so no
pipeline is lost when someone leaves.

## Viewing as another role

Only a Tenant Admin may preview another role, and they must choose which Sales
Person they are viewing as. A badge reading "Admin preview" stays on screen
throughout. **While previewing, all writing is blocked** — so a preview can
never create or change data under someone else's name.

## Boundaries that hold for everyone

- Nobody, in any role, can reach another tenant's data. Every query is scoped
  to the tenant on the server.
- Live tenants start empty. No demonstration content ever appears in one.
- Demonstration visitors cannot reach any live tenant, and cannot sign in to
  the demonstration at all.
- Each demonstration visitor edits only their own private copy. Nothing they
  do is visible to another visitor or changes what new visitors start from.

## Note for whoever maintains this

These were verified by reading the server routes. If the permission model
changes, re-read the routes rather than trusting this file — and re-check that
new write endpoints sit behind the demonstration guard, which is applied as
middleware at the application boundary precisely so a new endpoint cannot
escape it.
