import type { TargetPersona } from "@prospect/shared";

export interface RecipientCandidate {
  id: string;
  fullName: string;
  title: string | null;
  seniority: string | null;
  email: string | null;
}

const SENIORITY_RANK: Record<string, number> = { c_level: 5, vp: 4, director: 3, manager: 2, ic: 1 };

function seniorityScore(seniority: string | null): number {
  return seniority ? (SENIORITY_RANK[seniority] ?? 0) : 0;
}

function personaMatchScore(candidate: RecipientCandidate, personas: TargetPersona[]): number {
  let best = 0;
  const title = (candidate.title ?? "").toLowerCase();
  for (const persona of personas) {
    let score = 0;
    if (persona.seniority && candidate.seniority && persona.seniority === candidate.seniority) score += 3;
    const personaWords = persona.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (personaWords.some((w) => title.includes(w))) score += 4;
    if (persona.department && title.includes(persona.department.toLowerCase())) score += 1;
    if (score > best) best = score;
  }
  return best;
}

export function selectRecipient(candidates: RecipientCandidate[], targetPersonas: TargetPersona[]): RecipientCandidate | null {
  const withEmail = candidates.filter((c) => c.email && c.email.trim());
  if (withEmail.length === 0) return null;

  let best: RecipientCandidate | null = null;
  let bestScore = -1;
  for (const c of withEmail) {
    const score = personaMatchScore(c, targetPersonas) * 10 + seniorityScore(c.seniority);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
