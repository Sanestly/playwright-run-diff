import type {
  DiffFinding,
  DiffStatus,
  EvidenceRef,
  FindingCategory,
  Severity,
} from '@sanestly/contracts';

export const RULE_IDS = {
  timingRegression: 'RD-TIM-001',
  actionAdded: 'RD-ACT-001',
  actionRemoved: 'RD-ACT-002',
  actionFailed: 'RD-ACT-003',
  requestAdded: 'RD-NET-001',
  requestRemoved: 'RD-NET-002',
  statusChanged: 'RD-NET-003',
  serverErrorIntroduced: 'RD-NET-004',
  requestFailed: 'RD-NET-005',
  requestSlower: 'RD-NET-006',
  consoleAdded: 'RD-CON-001',
  consoleRemoved: 'RD-CON-002',
  errorAdded: 'RD-ERR-001',
  visualDiff: 'RD-VIS-001',
  visualMissing: 'RD-VIS-002',
  structureChanged: 'RD-STR-001',
  aggregateTimingRegression: 'RD-TIM-002',
} as const;

let counter = 0;
export function resetFindingCounter(): void {
  counter = 0;
}

export function makeFinding(input: {
  category: FindingCategory;
  severity: Severity;
  status: DiffStatus;
  title: string;
  details: string;
  evidence: EvidenceRef[];
  confidence: number;
  ruleId: string;
  suppressed?: boolean;
}): DiffFinding {
  counter += 1;
  return {
    id: `F-${String(counter).padStart(4, '0')}`,
    ...input,
  };
}
