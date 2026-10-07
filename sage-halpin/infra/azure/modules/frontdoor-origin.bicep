// Front Door origin group + App Service origin over Private Link + route.
//
// Front Door creates a Microsoft-managed private endpoint to the web app
// (groupId 'sites'). That connection arrives on the web app as PENDING and
// must be approved once (see README "Approve the Front Door private endpoint").
// Until it is approved the origin is unhealthy and Front Door returns errors.

param profileName string
param endpointName string
param customDomainName string
param location string

@description('Web app resource id (Private Link target).')
param webAppId string

@description('Web app default hostname (<app>.azurewebsites.net); used as origin and origin host header.')
param webAppHostName string

resource profile 'Microsoft.Cdn/profiles@2024-02-01' existing = {
  name: profileName
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' existing = {
  parent: profile
  name: endpointName
}

resource customDomain 'Microsoft.Cdn/profiles/customDomains@2024-02-01' existing = if (!empty(customDomainName)) {
  parent: profile
  name: empty(customDomainName) ? 'none' : customDomainName
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: profile
  name: 'app-service'
  properties: {
    sessionAffinityState: 'Disabled'
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/api/healthz'
      probeProtocol: 'Https'
      probeRequestType: 'GET'
      probeIntervalInSeconds: 60
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: 'web-app'
  properties: {
    hostName: webAppHostName
    originHostHeader: webAppHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
    sharedPrivateLinkResource: {
      privateLink: { id: webAppId }
      groupId: 'sites'
      privateLinkLocation: location
      requestMessage: 'Azure Front Door ${profileName} -> web app (approve once)'
    }
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'default'
  dependsOn: [origin]
  properties: {
    originGroup: { id: originGroup.id }
    customDomains: empty(customDomainName) ? [] : [{ id: customDomain.id }]
    // DECISION: HTTPS only, no HTTP->HTTPS redirect (README Deviations #7).
    supportedProtocols: ['Https']
    httpsRedirect: 'Disabled'
    forwardingProtocol: 'HttpsOnly'
    patternsToMatch: ['/*']
    linkToDefaultDomain: 'Enabled'
    enabledState: 'Enabled'
    // No caching: every response is dynamic or carries its own Cache-Control.
  }
}

output originGroupId string = originGroup.id
