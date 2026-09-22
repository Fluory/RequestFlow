---
paths:
  - "prompts/**"
  - "evals/**"
  - "src/**/prompts/**"
  - "src/**/rag/**"
  - "src/**/llm/**"
  - "src/**/agents/**"
  - "**/*prompt*"
  - "**/*embedding*"
  - "services/ai/**/prompts/**"
  - "services/ai/evals/**"
  - "services/ai/src/**/extraction/**"
  - "services/ai/src/**/grounding/**"
  - "src/features/extraction/**"
---

# AI / RAG rules (loaded when prompt, retrieval or agent code is read)

- Prompts are versioned in the repo; a change to prompt, retrieval or model runs the eval set (`evals/`) before the merge.
- The eval set is weighted by known weaknesses; every computed quality verdict counts in PASS/FAIL; prompt-injection cases are part of the set.
- Fake or mock paths are fail-closed: a failed client init aborts with an error, never silently switches to a mock.
- Retrieval respects permissions: documents only for users allowed to see them; no confidential data to external providers without approval; prompt and output logging without sensitive content.
- High-impact actions (send, delete, order, change rights): agent proposes → system shows target and effect → human confirms → execution with audit log.
