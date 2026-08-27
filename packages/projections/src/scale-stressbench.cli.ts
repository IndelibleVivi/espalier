import { runScaleReplayStressbench, scaleStressTargets } from "./scale-stressbench.js";

const requestedTargets = process.argv.slice(2).map((argument) => {
  const match = /^--entities=(\d+)$/.exec(argument);
  if (!match) throw new Error(`Unknown scale stressbench argument ${argument}; expected --entities=<count>`);
  return Number(match[1]);
});
const targets = requestedTargets.length > 0 ? requestedTargets : [...scaleStressTargets];

for (const target of targets) {
  const startedAt = performance.now();
  const result = runScaleReplayStressbench({ target_canonical_objects: target });
  process.stdout.write(`${JSON.stringify({
    ...result.corpus,
    duration_ms: Math.round(performance.now() - startedAt),
    profiles: result.profiles,
    replay_checkpoints: result.replay_checkpoints.map((checkpoint) => ({
      checkpoint_ref: checkpoint.checkpoint_ref,
      projection_revision: checkpoint.projection_revision,
      source_event_count: checkpoint.source_event_count,
      visible_entities: checkpoint.entities.length,
      visible_relations: checkpoint.relations.length,
      omitted_counts: checkpoint.omitted_counts,
      invariants: checkpoint.invariants,
      response_bytes: checkpoint.diagnostics.response_bytes,
    })),
  })}\n`);
}
