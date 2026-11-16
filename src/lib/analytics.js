// Pure data helpers: parsing, filtering, aggregation and risk quantification.

export const DAY_MS = 86_400_000;

// Severity (1-5) and illustrative expected loss per observed attempt (USD).
// These are editable in the UI; defaults are placeholders, not benchmarks.
export const ATTACK_PROFILES = {
  c2: { label: 'Command & control', severity: 5, lossPerEvent: 40000 },
  'command-injection': { label: 'Command injection', severity: 5, lossPerEvent: 12000 },
  'exploit-attempt': { label: 'Exploit attempt', severity: 4, lossPerEvent: 10000 },
  'sql-injection': { label: 'SQL injection', severity: 4, lossPerEvent: 8000 },
  'credential-stuffing': { label: 'Credential stuffing', severity: 4, lossPerEvent: 5000 },
  ddos: { label: 'DDoS', severity: 3, lossPerEvent: 6000 },
  'brute-force': { label: 'Brute force', severity: 3, lossPerEvent: 2000 },
  xss: { label: 'Cross-site scripting', severity: 2, lossPerEvent: 1500 },
  'port-scan': { label: 'Port scan', severity: 1, lossPerEvent: 100 },
};

const FALLBACK_PROFILE = { severity: 2, lossPerEvent: 1000 };

export function profileFor(type) {
  return ATTACK_PROFILES[type] || { ...FALLBACK_PROFILE, label: type };
}

export const PORT_SERVICES = {
  21: 'FTP',
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  443: 'HTTPS',
  445: 'SMB',
  1433: 'MSSQL',
  3306: 'MySQL',
  3389: 'RDP',
};

export function serviceName(port) {
  return PORT_SERVICES[port] ? `${port} · ${PORT_SERVICES[port]}` : String(port);
}

export function classifyAgent(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (!ua) return 'Empty';
  if (ua.includes('sqlmap')) return 'sqlmap';
  if (ua.includes('zgrab')) return 'zgrab';
  if (ua.startsWith('curl')) return 'curl';
  if (ua.startsWith('python')) return 'Python script';
  if (ua.includes('googlebot')) return 'Googlebot';
  if (ua.includes('iphone')) return 'Mobile browser';
  if (ua.startsWith('mozilla')) return 'Desktop browser';
  return 'Other';
}

export const AUTOMATED_AGENTS = new Set(['sqlmap', 'zgrab', 'curl', 'Python script']);

export function normalizeRow(row, index) {
  const timestamp = row.timestamp || '';
  const bytesSent = Number(row.bytes_sent) || 0;
  const bytesReceived = Number(row.bytes_received) || 0;
  const label = Number(row.label) === 1 ? 1 : 0;
  const agent = classifyAgent(row.user_agent);
  return {
    id: index,
    timestamp,
    day: timestamp.slice(0, 10),
    hour: Number(timestamp.slice(11, 13)) || 0,
    time: Date.parse(timestamp.replace(' ', 'T') + 'Z') || 0,
    src_ip: row.src_ip || '',
    dst_ip: row.dst_ip || '',
    src_port: Number(row.src_port) || 0,
    dst_port: Number(row.dst_port) || 0,
    protocol: row.protocol || 'unknown',
    bytes_sent: bytesSent,
    bytes_received: bytesReceived,
    bytes: bytesSent + bytesReceived,
    user_agent: row.user_agent || '',
    agent,
    automated: AUTOMATED_AGENTS.has(agent),
    url: row.url || '',
    is_internal_traffic: String(row.is_internal_traffic).toLowerCase() === 'true',
    label,
    attack_type: label ? row.attack_type || 'unknown' : 'benign',
  };
}

export const EMPTY_FILTERS = {
  from: '',
  to: '',
  scope: 'all', // all | internal | external
  protocol: 'all',
  attackType: 'all', // all | attacks | benign | <type>
  port: 'all',
  agent: 'all',
  search: '',
};

export function activeFilterCount(filters) {
  return Object.keys(EMPTY_FILTERS).filter((key) => filters[key] !== EMPTY_FILTERS[key]).length;
}

export function applyFilters(rows, filters) {
  const search = filters.search.trim().toLowerCase();
  const port = filters.port === 'all' ? null : Number(filters.port);
  return rows.filter((row) => {
    if (filters.from && row.day < filters.from) return false;
    if (filters.to && row.day > filters.to) return false;
    if (filters.scope === 'internal' && !row.is_internal_traffic) return false;
    if (filters.scope === 'external' && row.is_internal_traffic) return false;
    if (filters.protocol !== 'all' && row.protocol !== filters.protocol) return false;
    if (filters.attackType === 'attacks' && row.label !== 1) return false;
    if (filters.attackType === 'benign' && row.label !== 0) return false;
    if (!['all', 'attacks', 'benign'].includes(filters.attackType) && row.attack_type !== filters.attackType) {
      return false;
    }
    if (port !== null && row.dst_port !== port) return false;
    if (filters.agent !== 'all' && row.agent !== filters.agent) return false;
    if (search) {
      const haystack = `${row.src_ip} ${row.dst_ip} ${row.url} ${row.user_agent}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function countBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function sortedEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// Groups rows and returns [{ key, total, attacks, rate }] sorted by attacks then total.
function attackRateBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = map.get(key) || { key, total: 0, attacks: 0 };
    entry.total += 1;
    entry.attacks += row.label;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((entry) => ({ ...entry, rate: entry.total ? entry.attacks / entry.total : 0 }))
    .sort((a, b) => b.attacks - a.attacks || b.total - a.total);
}

function startOfWeek(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7; // Monday-based weeks
  return new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function datasetSpan(rows) {
  if (rows.length === 0) return { first: '', last: '', days: 0 };
  let first = rows[0].day;
  let last = rows[0].day;
  for (const row of rows) {
    if (row.day < first) first = row.day;
    if (row.day > last) last = row.day;
  }
  const days = Math.round((Date.parse(last) - Date.parse(first)) / DAY_MS) + 1;
  return { first, last, days };
}

export function riskBand(score) {
  if (score >= 75) return { label: 'Critical', tone: 'critical' };
  if (score >= 55) return { label: 'High', tone: 'high' };
  if (score >= 30) return { label: 'Moderate', tone: 'moderate' };
  return { label: 'Low', tone: 'low' };
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * Builds every metric the dashboard shows from the (already filtered) rows.
 * `assumptions` = { lossPerEvent: {type: usd}, controlEffectiveness: 0-1 }
 */
export function computeMetrics(rows, assumptions) {
  const span = datasetSpan(rows);
  const attacks = rows.filter((row) => row.label === 1);
  const total = rows.length;
  const attackRate = total ? attacks.length / total : 0;
  const internal = rows.filter((row) => row.is_internal_traffic).length;
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const automatedRows = rows.filter((row) => row.automated);
  const automatedAttacks = automatedRows.filter((row) => row.label === 1).length;

  // --- Quantification (annualised loss exposure per attack type)
  const annualFactor = span.days ? 365 / span.days : 0;
  const control = clamp01(assumptions.controlEffectiveness);
  const attackTypes = sortedEntries(countBy(attacks, (row) => row.attack_type)).map(([type, count]) => {
    const profile = profileFor(type);
    const lossPerEvent = assumptions.lossPerEvent[type] ?? profile.lossPerEvent;
    const annualFrequency = count * annualFactor;
    const inherentAle = annualFrequency * lossPerEvent;
    return {
      type,
      label: profile.label,
      severity: profile.severity,
      count,
      share: attacks.length ? count / attacks.length : 0,
      annualFrequency,
      lossPerEvent,
      inherentAle,
      residualAle: inherentAle * (1 - control),
    };
  });
  const inherentAle = attackTypes.reduce((sum, item) => sum + item.inherentAle, 0);
  const residualAle = inherentAle * (1 - control);
  const byAle = [...attackTypes].sort((a, b) => b.inherentAle - a.inherentAle);

  // --- Weekly trend
  const weeks = new Map();
  for (const row of rows) {
    const week = startOfWeek(row.day);
    const entry = weeks.get(week) || { week, total: 0, attacks: 0 };
    entry.total += 1;
    entry.attacks += row.label;
    weeks.set(week, entry);
  }
  const trend = [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((entry) => ({ ...entry, rate: entry.total ? entry.attacks / entry.total : 0 }));

  // --- Momentum: last 14 days vs previous 14 days (attack rate)
  let momentum = null;
  if (span.days >= 28) {
    const lastTime = Date.parse(span.last) + DAY_MS;
    const window = (fromDays, toDays) => {
      const lo = lastTime - fromDays * DAY_MS;
      const hi = lastTime - toDays * DAY_MS;
      const slice = rows.filter((row) => row.time >= lo && row.time < hi);
      const hits = slice.filter((row) => row.label === 1).length;
      return { total: slice.length, attacks: hits, rate: slice.length ? hits / slice.length : 0 };
    };
    const recent = window(14, 0);
    const prior = window(28, 14);
    momentum = { recent, prior, change: prior.rate ? recent.rate / prior.rate - 1 : 0 };
  }

  // --- Composite risk score (transparent, 0-100)
  const avgSeverity = attacks.length
    ? attacks.reduce((sum, row) => sum + profileFor(row.attack_type).severity, 0) / attacks.length
    : 0;
  const internalAttackShare = attacks.length
    ? attacks.filter((row) => row.is_internal_traffic).length / attacks.length
    : 0;
  const components = [
    {
      key: 'prevalence',
      label: 'Attack prevalence',
      detail: `${(attackRate * 100).toFixed(1)}% of events are malicious (10% = max)`,
      weight: 35,
      value: clamp01(attackRate / 0.1),
    },
    {
      key: 'severity',
      label: 'Severity mix',
      detail: `Average attack severity ${avgSeverity.toFixed(1)} / 5`,
      weight: 30,
      value: clamp01(avgSeverity / 5),
    },
    {
      key: 'momentum',
      label: 'Momentum',
      detail: momentum
        ? `Attack rate ${momentum.change >= 0 ? 'up' : 'down'} ${Math.abs(momentum.change * 100).toFixed(0)}% vs prior 14 days`
        : 'Needs at least 28 days of data',
      weight: 20,
      value: momentum ? clamp01(0.5 + momentum.change) : 0.5,
    },
    {
      key: 'internal',
      label: 'Internal exposure',
      detail: `${(internalAttackShare * 100).toFixed(0)}% of attacks originate on internal traffic`,
      weight: 15,
      value: clamp01(internalAttackShare / 0.5),
    },
  ].map((component) => ({ ...component, points: component.value * component.weight }));
  const riskScore = attacks.length ? Math.round(components.reduce((sum, c) => sum + c.points, 0)) : 0;

  // --- Port x attack type heatmap
  const heatPorts = attackRateBy(rows, (row) => row.dst_port)
    .filter((entry) => entry.attacks > 0)
    .slice(0, 10)
    .map((entry) => entry.key);
  const heatTypes = attackTypes.slice(0, 8).map((item) => item.type);
  const heatCounts = countBy(attacks, (row) => `${row.attack_type}|${row.dst_port}`);
  const heatmap = {
    ports: heatPorts,
    types: heatTypes,
    cell: (type, port) => heatCounts.get(`${type}|${port}`) || 0,
    max: Math.max(1, ...heatTypes.flatMap((type) => heatPorts.map((port) => heatCounts.get(`${type}|${port}`) || 0))),
  };

  // --- Hour of day
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, attacks: 0 }));
  for (const row of rows) {
    hours[row.hour].total += 1;
    hours[row.hour].attacks += row.label;
  }

  return {
    span,
    total,
    attacks: attacks.length,
    benign: total - attacks.length,
    attackRate,
    internal,
    internalRate: total ? internal / total : 0,
    totalBytes,
    automated: automatedRows.length,
    automatedAttacks,
    automatedAttackRate: automatedRows.length ? automatedAttacks / automatedRows.length : 0,
    attackTypes,
    byAle,
    inherentAle,
    residualAle,
    annualFactor,
    protocols: attackRateBy(rows, (row) => row.protocol),
    ports: attackRateBy(rows, (row) => row.dst_port),
    agents: attackRateBy(rows, (row) => row.agent),
    trend,
    momentum,
    components,
    riskScore,
    band: riskBand(riskScore),
    heatmap,
    hours,
  };
}

// --- Formatting
const numberFmt = new Intl.NumberFormat('en-US');
const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const formatNumber = (value) => numberFmt.format(Math.round(value));
export const formatUsd = (value) => usd.format(value);
export const formatUsdCompact = (value) => compactUsd.format(value);
// Like formatUsdCompact but without a trailing ".0" ($1M, $2.4M, $80K): used in prose.
const shortUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});
export const formatUsdShort = (value) => shortUsd.format(value);
export const formatPercent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

export function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDay(day) {
  if (!day) return '';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// --- CSV export
const EXPORT_COLUMNS = [
  'timestamp',
  'src_ip',
  'dst_ip',
  'src_port',
  'dst_port',
  'protocol',
  'bytes_sent',
  'bytes_received',
  'user_agent',
  'url',
  'is_internal_traffic',
  'label',
  'attack_type',
];

function csvCell(value) {
  const text = String(value ?? '');
  // Neutralise spreadsheet formula injection and quote special characters.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function rowsToCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(','));
  }
  return lines.join('\n');
}
