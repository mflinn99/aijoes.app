// Network: one VNet with three subnets, NSGs, an optional NAT gateway for
// predictable egress, and the private DNS zones the private endpoints and the
// VNet-injected PostgreSQL server resolve through.
//
// IMPORTANT: App Service VNet integration (the app-integration subnet) is
// OUTBOUND ONLY. It lets the app reach Postgres, Key Vault, Storage and ACR
// privately. It does nothing for inbound traffic: inbound privacy comes from
// the web app's publicNetworkAccess = 'Disabled' plus Front Door's Private Link
// connection (a Microsoft-managed private endpoint) — see appservice.bicep.

@description('Azure region.')
param location string

@description('Name prefix, e.g. sagehalpin-prod.')
param namePrefix string

@description('Tags applied to every resource.')
param tags object

@description('VNet address space.')
param addressPrefix string

@description('app-integration subnet (delegated to Microsoft.Web/serverFarms). /26 or larger; /24 recommended so plan scale-out never runs out of addresses.')
param appIntegrationSubnetPrefix string

@description('private-endpoints subnet.')
param privateEndpointsSubnetPrefix string

@description('postgres subnet (delegated to Microsoft.DBforPostgreSQL/flexibleServers).')
param postgresSubnetPrefix string

@description('Attach a NAT gateway with a static public IP to the app-integration subnet for outbound internet (Claude on Foundry / Anthropic API, ACS email).')
param deployNatGateway bool

@description('Create the privatelink.azurecr.io zone (only when the registry is private).')
param acrPrivate bool

@description('Name of the PostgreSQL flexible server; its VNet-injection DNS zone is <server>.private.postgres.database.azure.com.')
param postgresServerName string

// ---------------------------------------------------------------- NSGs
resource nsgApp 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-${namePrefix}-app-integration'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-out-postgres'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: appIntegrationSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: postgresSubnetPrefix
          destinationPortRange: '5432'
        }
      }
      {
        name: 'allow-out-private-endpoints-https'
        properties: {
          priority: 110
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: appIntegrationSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: privateEndpointsSubnetPrefix
          destinationPortRange: '443'
        }
      }
      {
        // Claude on Foundry / Anthropic API, ACS email, Entra ID token endpoint,
        // Azure Monitor ingestion. HTTPS only.
        name: 'allow-out-internet-https'
        properties: {
          priority: 200
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: appIntegrationSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '443'
        }
      }
      {
        name: 'deny-out-internet-other'
        properties: {
          priority: 4000
          direction: 'Outbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Internet'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgPe 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-${namePrefix}-private-endpoints'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-in-https-from-vnet'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: privateEndpointsSubnetPrefix
          destinationPortRange: '443'
        }
      }
      {
        name: 'deny-in-all'
        properties: {
          priority: 4000
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgPg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-${namePrefix}-postgres'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-in-postgres-from-app'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: appIntegrationSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: postgresSubnetPrefix
          destinationPortRange: '5432'
        }
      }
      {
        // Zone-redundant HA replicates between the primary and standby inside
        // this subnet.
        name: 'allow-in-intra-subnet'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: postgresSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: postgresSubnetPrefix
          destinationPortRange: '*'
        }
      }
      {
        name: 'deny-in-vnet-other'
        properties: {
          priority: 4000
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// ---------------------------------------------------------------- NAT
// DECISION: a NAT gateway is not in the approved resource list but is added
// (param, default on) because the app must call Claude over the internet and
// new subnets have no default outbound access. It also gives one static egress
// IP that can be allow-listed. Cost: ~£30/month + data processed.
resource natIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = if (deployNatGateway) {
  name: 'pip-${namePrefix}-nat'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource nat 'Microsoft.Network/natGateways@2024-05-01' = if (deployNatGateway) {
  name: 'ng-${namePrefix}'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    idleTimeoutInMinutes: 4
    publicIpAddresses: [{ id: natIp.id }]
  }
}

// ---------------------------------------------------------------- VNet
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [
      {
        name: 'app-integration'
        properties: {
          addressPrefix: appIntegrationSubnetPrefix
          defaultOutboundAccess: false
          networkSecurityGroup: { id: nsgApp.id }
          natGateway: deployNatGateway ? { id: nat.id } : null
          delegations: [
            {
              name: 'webapp'
              properties: { serviceName: 'Microsoft.Web/serverFarms' }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: privateEndpointsSubnetPrefix
          defaultOutboundAccess: false
          networkSecurityGroup: { id: nsgPe.id }
          // Make the NSG apply to private endpoint traffic.
          privateEndpointNetworkPolicies: 'Enabled'
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          defaultOutboundAccess: false
          networkSecurityGroup: { id: nsgPg.id }
          delegations: [
            {
              name: 'postgres'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
    ]
  }
}

// ---------------------------------------------------------------- Private DNS
var baseZones = [
  'privatelink.vaultcore.azure.net'
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.azurewebsites.net'
]
var zoneNames = concat(baseZones, acrPrivate ? ['privatelink${environment().suffixes.acrLoginServer}'] : [])

resource zones 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for z in zoneNames: {
    name: z
    location: 'global'
    tags: tags
  }
]

resource zoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (z, i) in zoneNames: {
    parent: zones[i]
    name: 'link-${vnet.name}'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
  }
]

// DECISION: server-specific zone instead of privatelink.postgres.database.azure.com
// (README Deviations #6).
// VNet-injected Flexible Server: Microsoft recommends a zone named
// <server>.private.postgres.database.azure.com rather than the privatelink.*
// zone (which is for the private-endpoint networking mode).
resource pgZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${postgresServerName}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource pgZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: pgZone
  name: 'link-${vnet.name}'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

output vnetId string = vnet.id
output appIntegrationSubnetId string = vnet.properties.subnets[0].id
output privateEndpointsSubnetId string = vnet.properties.subnets[1].id
output postgresSubnetId string = vnet.properties.subnets[2].id
output keyVaultZoneId string = zones[0].id
output blobZoneId string = zones[1].id
output webAppZoneId string = zones[2].id
output acrZoneId string = acrPrivate ? zones[3].id : ''
output postgresZoneId string = pgZone.id
output natPublicIp string = deployNatGateway ? natIp!.properties.ipAddress : ''
