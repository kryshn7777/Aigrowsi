// Every sentence of AIGROW's own copy lives here, taken from the project brief ("Website description.txt").
// Lines marked `plate` describe the drawing on screen; they make no claims about AIGROW itself.

export const site = {
  title: 'AIGROW — Build intelligence that compounds',
  description:
    'AIGROW engineers adaptive AI systems: coordinated models, measurable evaluation, controlled improvement, and human-governed intelligence infrastructure.',
  tagline: 'Intelligence is not a static feature. It is a growth process.',
}

export const arrival = {
  kicker: 'AI systems engineering, designed to evolve',
  title: ['Build intelligence', 'that compounds.'],
  lede: 'The next leap in AI will not come from a model alone. It will come from the systems around it: coordinated, evaluated, connected to the right context, and engineered to improve.',
  note: 'Capability with measurement. Autonomy with boundaries.',
  primary: 'Explore the architecture',
  secondary: 'Define your system',
}

export const record = {
  title: 'The intelligence growth engine',
  body: [
    'AIGROW is an intelligence-systems engineering concept focused on designing, orchestrating, and continuously improving AI systems.',
    'It brings models, specialized agents, tools, data, and evaluation methods into a coherent architecture built around measurable objectives. Instead of treating a model’s first output as the finished result, AIGROW treats capability as an iterative engineering process: define the objective, construct the system, observe its behavior, evaluate its performance, and refine it through controlled improvement.',
  ],
  principle:
    'The foundation is a simple principle: intelligence becomes useful when capability is connected to context, feedback, and purpose.',
  plate:
    'The wordmark is the summit. Every ring beneath it is a layer of the system that holds it up. Drag across the plate to cut a section and read what it stands on.',
  keys: 'Keyboard: arrow keys turn and move the section line.',
}

export const architecture = {
  label: 'The architecture',
  title: 'Intelligence is not a feature you switch on. It is a system you design.',
  intro:
    'A model can generate an answer. A well-engineered system knows when to reason, where to look, which tools to use, how to verify its work, and when a human must take over.',
  pillars: [
    {
      state: 'orchestration',
      name: 'Orchestration',
      line: 'Coordinate specialized models, agents, tools, and knowledge into integrated workflows.',
      detail: 'Connect models, agents, tools, and private knowledge into one coherent system with explicit roles and handoffs.',
      plate: 'Each letter grows its own rings until they meet. The blue circles mark where separate parts become one system.',
    },
    {
      state: 'evaluation',
      name: 'Evaluation',
      line: 'Measure task performance, reliability, cost, latency, and failure modes against explicit baselines.',
      detail: 'Evaluate real tasks against baselines. Track quality, cost, latency, reliability, and failure modes—not just impressive demos.',
      plate: 'Section A to A′ through the whole specimen, measured up from the plate it stands on.',
    },
    {
      state: 'evolution',
      name: 'Evolution',
      line: 'Improve system architecture through evidence-led iterations, controlled changes, and reproducible tests.',
      detail: 'Use evaluation results to guide versioned changes to workflows, context, instructions, and tools—with review and rollback.',
      plate: 'Blue is the proposed edge. The dotted line is the current edge, kept as the way back.',
    },
    {
      state: 'governance',
      name: 'Governance',
      line: 'Make permissions, oversight, accountability, and operational boundaries integral to the system.',
      detail: 'Build in permission boundaries, traceable decisions, escalation paths, and human ownership from the beginning.',
      plate: 'The boundary is drawn before anything grows. Growth that reaches it stops there.',
    },
  ],
} as const

export const method = {
  label: 'The growth loop',
  title: 'From a capable model to a capable system.',
  lede: 'Improvement is not a mysterious leap. It is a disciplined loop that turns evidence into better architecture—and makes each change testable.',
  phases: [
    {
      state: 'define',
      name: 'Define',
      line: 'Specify the goal, constraints, users, and what success looks like.',
      plate: 'Everything is lifted away except the purpose the system will stand on.',
    },
    {
      state: 'compose',
      name: 'Compose',
      line: 'Connect models, tools, data, policies, and human checkpoints.',
      plate: 'Each sheet arrives in blue, as a proposal, and turns white once it is set.',
    },
    {
      state: 'instrument',
      name: 'Instrument',
      line: 'Capture outputs, traces, costs, edge cases, and failure signals.',
      plate: 'Lifted apart, every layer can be read and traced.',
    },
    {
      state: 'evaluate',
      name: 'Evaluate',
      line: 'Test against agreed criteria, adversarial cases, and baselines.',
      plate: 'A section through the stack at its centre line. The plate is the baseline.',
    },
    {
      state: 'refine',
      name: 'Refine',
      line: 'Make controlled changes, verify the gains, and retain rollback paths.',
      plate: 'The summit is recut to its true outline. The rough outline stays dotted, as the way back.',
    },
  ],
} as const

export const principles = {
  label: 'Design principles',
  title: 'More capability. Less mystique.',
  body: 'We replace the mythology around AI with a rigorous engineering practice. Ambition sets the horizon; evidence determines the next step.',
  items: [
    {
      name: 'Architecture over spectacle',
      line: 'One impressive answer is not a system. We design for repeatable performance across tasks, contexts, and imperfect conditions.',
    },
    {
      name: 'Iteration over assertion',
      line: 'Progress is a measured delta against a baseline, with regressions visible and decisions reproducible.',
    },
    {
      name: 'Agency with boundaries',
      line: 'Autonomy is scoped to a purpose. Permissions, budgets, escalation rules, and human oversight are part of the design.',
    },
    {
      name: 'Open to the frontier',
      line: 'We build for changing models and emerging methods without tying the system’s value to one provider or one paradigm.',
    },
  ],
}

export const frontier = {
  label: 'The long horizon',
  title: ['The frontier is not a slogan.', 'It is a responsibility.'],
  body: [
    'More general and more capable AI systems could reshape how knowledge is created, decisions are made, and complex work gets done. Reaching that frontier requires more than scale. It requires disciplined evaluation, clear objectives, security, and an honest accounting of limitations.',
    'AIGROW is built around that discipline. We do not claim to have achieved superintelligence. We focus on engineering systems whose capabilities can be tested, whose behavior can be inspected, and whose boundaries remain explicit as they improve.',
  ],
  ambition:
    'AIGROW’s long-term ambition is to contribute to the engineering discipline needed for increasingly capable and general AI systems. Its immediate principle is more concrete: build systems whose capabilities can be tested, whose limitations can be understood, and whose improvement can be demonstrated.',
  tag: 'A long-term ambition. An evidence-led method. Human accountability throughout.',
}

export const fields = {
  label: 'Where it can grow',
  title: 'Purpose-built for problems that resist simple automation.',
  intro:
    'Start with a difficult workflow, a high-value knowledge problem, or an ambitious research direction. Shape the intelligence around the task—not the other way around.',
  items: [
    {
      id: 'research',
      name: 'Research systems',
      line: 'Coordinate retrieval, analysis, synthesis, source checking, and expert review across complex research workflows.',
      plate: 'Eight separate sources, grown until they read as one body of work.',
    },
    {
      id: 'operations',
      name: 'Adaptive operations',
      line: 'Move beyond brittle one-step automation toward workflows that detect exceptions, gather context, and escalate appropriately.',
      plate: 'A workflow line with two exceptions on it and a branch that escalates to a person.',
    },
    {
      id: 'decisions',
      name: 'Decision infrastructure',
      line: 'Combine structured data, scenario analysis, explicit uncertainty, and accountable human decisions in one auditable process.',
      plate: 'Three scenarios from one decision point. The outer rings stay dashed: uncertainty, stated.',
    },
  ],
} as const

export const resolution = {
  title: 'AIGROW.',
  line: 'Intelligence is not a static feature. It is a growth process.',
}

export const next = {
  lead: 'The next iteration starts with a question.',
  title: 'What should your intelligence system make possible?',
  body: 'Bring the problem, the constraints, and the outcome that matters. The first step is to define a system that can be built, tested, and improved.',
  staked: 'Layer 14 is staked out. It is not built yet.',
  fields: [
    { id: 'goal', label: 'The goal', hint: 'What should the system achieve?' },
    { id: 'constraints', label: 'The constraints', hint: 'Limits, budgets, rules it must respect.' },
    { id: 'users', label: 'The users', hint: 'Who relies on it, and who oversees it?' },
    { id: 'success', label: 'What success looks like', hint: 'How will you know it worked?' },
  ],
  stakes: 'Each answer drives a stake into the plate.',
  privacy:
    'Nothing is sent from this page. There is no intake channel yet, so the brief stays with you: copy it or download it.',
  privacyEmail: 'The email button opens your own mail app with the brief filled in. Nothing is sent from this page.',
}
