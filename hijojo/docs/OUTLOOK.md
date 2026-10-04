# Connecting Outlook

Hijojo sends introductions, follow-ups and handoffs from one Outlook mailbox and
reads that mailbox's inbox for replies, using Microsoft Graph with an app
registration (client credentials). Nothing is connected yet.

## 1. Register the app

In Microsoft Entra admin centre → App registrations → New registration:

- Name: `Hijojo`
- Supported account types: this organisation only
- No redirect URI

Under **API permissions** add Microsoft Graph **application** permissions:

| Permission | Why |
| --- | --- |
| `Mail.ReadWrite` | Create the draft (so a send can be reconciled) and read replies |
| `Mail.Send` | Send the draft |

Grant admin consent. Under **Certificates & secrets** create a client secret.

## 2. Restrict it to one mailbox

Application permissions apply to every mailbox in the tenant unless restricted.
Restrict them to the sender mailbox with Exchange Online RBAC for Applications
(or the older application access policy):

```powershell
Connect-ExchangeOnline
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Hijojo"
New-ManagementScope -Name "Hijojo sender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'outreach@aigogo.ai'"
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.ReadWrite" -CustomResourceScope "Hijojo sender"
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "Hijojo sender"
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource outreach@aigogo.ai
```

## 3. Configure the deployment

Set, in the server environment (not in source, not in the UI):

```
HIJOJO_GRAPH_TENANT_ID=<tenant id>
HIJOJO_GRAPH_CLIENT_ID=<client id>
HIJOJO_GRAPH_CLIENT_SECRET=<secret>
HIJOJO_SENDER_MAILBOX=outreach@aigogo.ai
HIJOJO_SEND_MODE=live
```

Then an administrator switches live sending on in **Settings**. Until all three
are in place (live mode, Outlook configured, the switch) nothing is sent.

## How it behaves

- **Sending.** Each message is created as a draft carrying a private
  idempotency property, then sent. Ids are immutable (`Prefer:
  IdType="ImmutableId"`), so the same id identifies the message after it moves
  to Sent Items.
- **Uncertain sends.** If the send call fails after the draft exists, the
  message is marked uncertain and reconciled: Outlook is asked whether the
  draft is still a draft. It is only re-sent if Outlook confirms it was not
  sent. If that cannot be established after three attempts, it is held for a
  human.
- **Replies.** The inbox is polled (default every five minutes) with an
  overlapping window; messages are de-duplicated by id. Replies are matched by
  conversation, then sender address, then sender domain. Any reply stops
  automation for that prospect immediately.
- **Bounces** arrive as non-delivery reports in the same inbox and suppress the
  address.

## Deferred

Graph change notifications (webhooks with subscription renewal) would cut reply
latency from minutes to seconds. Polling was chosen first because it needs no
public endpoint and cannot silently lapse; add subscriptions if latency matters.
