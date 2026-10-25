import { runAgent } from '../agent/engine.js';
import { LabProvider } from './provider.js';
import { createLabVision } from './vision.js';

export async function runScenario({ scenario, config, settings, llm, logger }) {
  const trace = [];
  const provider = new LabProvider(scenario, { trace, logger });
  const labConfig = {
    ...config,
    goofish: { ...config.goofish, provider: 'lab' },
    vision: { ...config.vision, enabled: true, maxPhotos: 4 },
    images: { ...config.images, mode: 'vision' },
  };
  const startedAt = Date.now();
  const outcome = await runAgent({
    query: scenario.client_query,
    provider,
    settings,
    llm,
    config: labConfig,
    logger,
    visionAnalyzer: createLabVision(scenario),
  });
  return {
    result: outcome.result,
    calls: outcome.calls,
    finishAttempts: outcome.state.finishAttempts,
    trace,
    usage: outcome.usage,
    durationMs: outcome.durationMs,
    warnings: outcome.finishWarnings,
    startedAt,
  };
}
