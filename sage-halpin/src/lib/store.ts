import { scopedKey } from "./userScope";

export type KPIData = {
  cashRunway: number;
  revenue: number;
  revenuePrev: number;
  churnRate: number;
  pipelineCoverage: number;
  burnMultiple: number;
  updatedAt: string;
};

export type KPIStatus = "green" | "amber" | "red";

export type Decision = {
  id: string;
  title: string;
  owner: string;
  deadline: string;
  status: "not_started" | "in_progress" | "done";
  impactArea: "revenue" | "cost" | "people" | "product" | "strategy" | "risk";
  notes: string;
  createdAt: string;
};

export type GrowthLever = {
  id: string;
  name: string;
  expectedImpact: string;
  confidence: "low" | "medium" | "high";
  owner: string;
};

export type Risk = {
  id: string;
  name: string;
  severity: "low" | "medium" | "high";
  category: "cash" | "sales" | "product" | "people" | "legal" | "operational";
  owner: string;
};

const DEFAULTS: {
  kpis: KPIData;
  decisions: Decision[];
  levers: GrowthLever[];
  risks: Risk[];
} = {
  kpis: {
    cashRunway: 18,
    revenue: 420,
    revenuePrev: 390,
    churnRate: 4.2,
    pipelineCoverage: 3.1,
    burnMultiple: 1.4,
    updatedAt: new Date().toISOString(),
  },
  decisions: [
    {
      id: "d1",
      title: "Evaluate enterprise pricing restructure",
      owner: "CEO",
      deadline: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      status: "in_progress",
      impactArea: "revenue",
      notes: "Mid-market expansion may require tiered packaging.",
      createdAt: new Date().toISOString(),
    },
  ],
  levers: [
    {
      id: "l1",
      name: "Enterprise segment expansion",
      expectedImpact: "+20–30% ARR",
      confidence: "medium",
      owner: "Sales",
    },
    {
      id: "l2",
      name: "Product-led growth loop",
      expectedImpact: "+15% activation",
      confidence: "high",
      owner: "Product",
    },
  ],
  risks: [
    {
      id: "r1",
      name: "Cash runway below 12 months",
      severity: "medium",
      category: "cash",
      owner: "CFO",
    },
    {
      id: "r2",
      name: "Churn spike in high-value accounts",
      severity: "medium",
      category: "sales",
      owner: "CS Lead",
    },
  ],
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  localStorage.setItem(scopedKey(key), JSON.stringify(value));
}

export const store = {
  getKPIs: () => load<KPIData>("kpis", DEFAULTS.kpis),
  setKPIs: (data: KPIData) => save("kpis", data),

  getDecisions: () => load<Decision[]>("decisions", DEFAULTS.decisions),
  setDecisions: (data: Decision[]) => save("decisions", data),

  getLevers: () => load<GrowthLever[]>("levers", DEFAULTS.levers),
  setLevers: (data: GrowthLever[]) => save("levers", data),

  getRisks: () => load<Risk[]>("risks", DEFAULTS.risks),
  setRisks: (data: Risk[]) => save("risks", data),
};

export function kpiStatus(metric: string, value: number): KPIStatus {
  switch (metric) {
    case "cashRunway":
      return value < 6 ? "red" : value < 12 ? "amber" : "green";
    case "churnRate":
      return value > 10 ? "red" : value > 7 ? "amber" : "green";
    case "pipelineCoverage":
      return value < 2 ? "red" : value < 3 ? "amber" : "green";
    case "burnMultiple":
      return value > 2 ? "red" : value > 1.5 ? "amber" : "green";
    case "revenueGrowth":
      return value < 0 ? "red" : value < 5 ? "amber" : "green";
    default:
      return "green";
  }
}

export type Alert = {
  id: string;
  severity: "critical" | "warning" | "info";
  persona: string;
  message: string;
};

export function generateAlerts(kpis: KPIData): Alert[] {
  const alerts: Alert[] = [];
  const growth = kpis.revenuePrev > 0 ? ((kpis.revenue - kpis.revenuePrev) / kpis.revenuePrev) * 100 : 0;

  if (kpis.cashRunway < 6)
    alerts.push({ id: "a1", severity: "critical", persona: "RISK", message: `Cash runway at ${kpis.cashRunway} months — immediate capital action required.` });
  else if (kpis.cashRunway < 12)
    alerts.push({ id: "a2", severity: "warning", persona: "RISK", message: `Cash runway at ${kpis.cashRunway} months — bridge planning advised within 60 days.` });

  if (kpis.churnRate > 10)
    alerts.push({ id: "a3", severity: "critical", persona: "GOVERNANCE", message: `Churn at ${kpis.churnRate}% — retention failure in high-value cohort likely.` });
  else if (kpis.churnRate > 7)
    alerts.push({ id: "a4", severity: "warning", persona: "GOVERNANCE", message: `Churn at ${kpis.churnRate}% — exceeds benchmark. Root cause analysis required.` });

  if (kpis.pipelineCoverage < 2)
    alerts.push({ id: "a5", severity: "critical", persona: "COMMERCIAL", message: `Pipeline coverage at ${kpis.pipelineCoverage}x — revenue target at risk this quarter.` });
  else if (kpis.pipelineCoverage < 3)
    alerts.push({ id: "a6", severity: "warning", persona: "COMMERCIAL", message: `Pipeline coverage at ${kpis.pipelineCoverage}x — below healthy threshold of 3x.` });

  if (kpis.burnMultiple > 2)
    alerts.push({ id: "a7", severity: "critical", persona: "RISK", message: `Burn multiple at ${kpis.burnMultiple} — capital efficiency unsustainable at current ARR growth.` });
  else if (kpis.burnMultiple > 1.5)
    alerts.push({ id: "a8", severity: "warning", persona: "RISK", message: `Burn multiple at ${kpis.burnMultiple} — efficiency tightening advised.` });

  if (growth < 0)
    alerts.push({ id: "a9", severity: "critical", persona: "COMMERCIAL", message: `Revenue declined ${Math.abs(growth).toFixed(1)}% month-on-month — revenue contraction signal.` });
  else if (growth < 5)
    alerts.push({ id: "a10", severity: "warning", persona: "GOVERNANCE", message: `Revenue growth at ${growth.toFixed(1)}% MoM — below minimum growth threshold.` });

  return alerts;
}
