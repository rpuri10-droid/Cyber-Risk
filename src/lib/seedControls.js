// Demo controls. Costs and effectiveness ranges are illustrative starting points, not
// benchmarks: replace them with your own quotes and estimates on the Controls page.
// Reductions are fractions (0.35 = 35%) given as min / most likely / max.

const range = (min, likely, max) => ({ min, likely, max });
const NONE = range(0, 0, 0);

export const SEED_CONTROLS = [
  {
    id: 'mfa',
    name: 'Multi-factor authentication (MFA)',
    description: 'Phishing-resistant MFA on every external login, VPN and admin console.',
    annualCost: 60_000,
    implementationCost: 40_000,
    lefReduction: range(0.6, 0.8, 0.95),
    lmReduction: NONE,
    scenarioIds: ['credential-stuffing', 'brute-force'],
  },
  {
    id: 'waf',
    name: 'Web application firewall (WAF)',
    description: 'Managed WAF with tuned rules in front of all internet-facing applications.',
    annualCost: 70_000,
    implementationCost: 30_000,
    lefReduction: range(0.35, 0.55, 0.75),
    lmReduction: NONE,
    scenarioIds: ['sql-injection', 'xss', 'command-injection'],
  },
  {
    id: 'edr',
    name: 'Endpoint detection & response (EDR)',
    description: 'EDR agents on servers and workstations with 24×7 managed response.',
    annualCost: 180_000,
    implementationCost: 90_000,
    lefReduction: range(0.15, 0.3, 0.45),
    lmReduction: range(0.2, 0.35, 0.5),
    scenarioIds: ['c2', 'exploit-attempt', 'command-injection'],
  },
  {
    id: 'backups',
    name: 'Immutable backups & restore drills',
    description: 'Offline, immutable backups of critical systems with quarterly restore tests.',
    annualCost: 90_000,
    implementationCost: 150_000,
    lefReduction: NONE,
    lmReduction: range(0.15, 0.3, 0.45),
    scenarioIds: ['c2', 'exploit-attempt'],
  },
  {
    id: 'pam',
    name: 'Privileged access management (PAM)',
    description: 'Vaulted admin credentials, just-in-time elevation and session recording.',
    annualCost: 220_000,
    implementationCost: 300_000,
    lefReduction: range(0.1, 0.2, 0.3),
    lmReduction: range(0.15, 0.25, 0.4),
    scenarioIds: ['c2', 'command-injection', 'brute-force'],
  },
  {
    id: 'phishing-training',
    name: 'Phishing & security awareness training',
    description: 'Monthly simulated phishing with targeted follow-up training.',
    annualCost: 45_000,
    implementationCost: 10_000,
    lefReduction: range(0.05, 0.12, 0.2),
    lmReduction: NONE,
    scenarioIds: ['credential-stuffing', 'c2'],
  },
  {
    id: 'ddos-scrubbing',
    name: 'Always-on DDoS scrubbing service',
    description: 'Premium always-on traffic scrubbing for all public endpoints.',
    annualCost: 400_000,
    implementationCost: 60_000,
    lefReduction: NONE,
    lmReduction: range(0.3, 0.5, 0.7),
    scenarioIds: ['ddos'],
  },
  {
    id: 'attack-surface',
    name: 'External attack surface monitoring',
    description: 'Continuous discovery and closure of exposed ports and forgotten services.',
    annualCost: 85_000,
    implementationCost: 120_000,
    lefReduction: range(0.2, 0.4, 0.6),
    lmReduction: NONE,
    scenarioIds: ['port-scan'],
  },
];
