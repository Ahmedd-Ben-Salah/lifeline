/**
 * Scripted agent voice — the fallback when the LLM is off, slow or fails validation.
 * Same facts as the LLM gets; only the wording is fixed. Plain words: a 12-year-old should follow it.
 */
type Facts = Record<string, string | number>;

const T: Record<string, (f: Facts) => string> = {
  warn: f => `A dust storm started near ${f.origin}. In ${f.runsReached} of ${f.runs} simulations it reaches ${f.target} in ${f.arrivalMin} to ${f.arrivalMax} days.`,
  need: f => `Arcadia will run low. It needs about ${f.water} kg of water and ${f.o2} kg of air to stay safe for ${f.criticalDays} days. Please answer.`,
  timeout: f => `Arcadia has not answered for ${f.minutes} minutes. Jezero will act for them, as the rules allow.`,
  offer: f => `Utopia can send ${f.water} kg of water and ${f.o2} kg of air and still keep ${f.keepDays} days for itself. Rover 7 can leave now.`,
  accept: f => `Thank you, Utopia. We accept ${f.water} kg of water and ${f.o2} kg of air. The team has been told.`,
  fault: f => `Rover 3 broke down on the way to Arcadia with ${f.stranded} kg of water. Rover 7 will pick up that water on its way. It arrives in ${f.eta} days.`,
  order: f => `Order from Earth for next season: ${f.ships} rockets with ${f.tonnes} tonnes of supplies. They can leave in ${f.daysToWindow} days. Two people must approve first.`,
  report: f => `Update for Earth: a dust storm has a ${f.chance} chance to hit Arcadia. Rover 7 is bringing help. The Earth order needs your approval.`,
  why: f => `Rover 3 broke down on this road with ${f.stranded} kg of water. Rover 7 picks it up on the way. This adds ${f.extraSols} days. Rover 7 arrives in ${f.eta} days, ${Number(f.eta) < Number(f.stormP10) ? 'just before the storm' : 'about when the storm arrives'}.`,
};

export function scripted(step: string, facts: Facts): string {
  const t = T[step];
  return t ? t(facts) : String(facts.text ?? '');
}
