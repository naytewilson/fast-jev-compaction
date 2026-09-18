import { describe, expect, it } from 'vitest';
import {
  campaignCorpus,
  CAMPAIGN_CORPUS_ID,
  mechanicalLabelTargets,
  MECHANICAL_VERIFIER_ID,
  mintCampaignLabels,
  splitCampaignCorpus,
} from '../src/lab/campaign-corpus.js';
import { MAPPED_OBSERVATION_AXES } from '../src/lab/types.js';
import { validateSemanticCalibrationLabel } from '../src/lab/semantic-label.js';

const d = (c: string) => 'sha256:' + c.repeat(64) as `sha256:${string}`;

describe('campaignCorpus', () => {
  it('is deterministic and trace-unique', () => {
    const a = campaignCorpus();
    const b = campaignCorpus();
    expect(a).toEqual(b);
    const ids = new Set(a.map((t) => t.trace_id));
    expect(ids.size).toBe(a.length);
    const digests = new Set(
      a.flatMap((t) => t.candidates.map((c) => c.recovery.source_digest)),
    );
    expect(digests.size).toBe(a.length);
  });

  it('covers every critical placement and stderr class', () => {
    const corpus = campaignCorpus();
    const targets = corpus.map((t) => mechanicalLabelTargets(t.candidates[0]));
    for (const axis of MAPPED_OBSERVATION_AXES) {
      const ones = targets.filter((t) => t[axis] === 1).length;
      const zeros = targets.filter((t) => t[axis] === 0).length;
      expect(ones, `${axis} needs positive examples`).toBeGreaterThan(0);
      expect(zeros, `${axis} needs negative examples`).toBeGreaterThan(0);
    }
  });
});

describe('mechanicalLabelTargets', () => {
  const corpus = campaignCorpus();
  const byPlacement = (placement: string, stderr = 'none', lines = 400) => {
    const trace = corpus.find(
      (t) => t.trace_id.startsWith('ct-') &&
        mechanicalLabelTargets(t.candidates[0]) &&
        t.candidates[0].stdout.includes('CRITICAL') === (placement !== 'absent') &&
        t.candidates[0].stderr === (stderr === 'none' ? '' : t.candidates[0].stderr) &&
        t.candidates[0].stdout.split('\n').length === lines,
    );
    return trace;
  };

  it('middle-omitted critical evidence is insufficient + needs full content', () => {
    const mid = corpus.find(
      (t) => {
        const tg = mechanicalLabelTargets(t.candidates[0]);
        return tg.full_content_needed === 1 && t.candidates[0].stdout.split('\n').length === 400;
      },
    );
    expect(mid).toBeDefined();
    const t = mechanicalLabelTargets(mid!.candidates[0]);
    expect(t.evidence_sufficient).toBe(0);
    expect(t.still_needed).toBe(1);
    expect(t.full_content_needed).toBe(1);
  });

  it('head/tail placements are sufficient without needing full content', () => {
    const ok = corpus.filter((t) => {
      const tg = mechanicalLabelTargets(t.candidates[0]);
      return tg.evidence_sufficient === 1 && tg.still_needed === 1;
    });
    expect(ok.length).toBeGreaterThan(0);
    for (const t of ok) {
      expect(mechanicalLabelTargets(t.candidates[0]).full_content_needed).toBe(0);
    }
  });

  it('identity-inconsistent recovery drives recoverable=0', () => {
    const bad = corpus.filter((t) => {
      const c = t.candidates[0];
      const actual = Buffer.byteLength(
        JSON.stringify({
          schema: 'anvil.tool-evidence.v0',
          stdout: c.stdout,
          stderr: c.stderr,
          exit_status: c.exit_status,
        }),
        'utf8',
      );
      return c.recovery.byte_count !== actual;
    });
    expect(bad.length).toBe(2);
    for (const t of bad) {
      expect(t.candidates[0].recovery.recovery_ref.startsWith('cas:')).toBe(true);
      expect(mechanicalLabelTargets(t.candidates[0]).recoverable).toBe(0);
    }
  });

  it('stderr presence drives unresolved_evidence=1', () => {
    for (const t of corpus) {
      const c = t.candidates[0];
      const tg = mechanicalLabelTargets(c);
      if (c.stderr.length > 0 || c.exit_status !== 0) {
        expect(tg.unresolved_evidence).toBe(1);
      }
    }
  });
});

describe('mintCampaignLabels', () => {
  it('mints STRONG labels for all five axes bound to real source digests', () => {
    const corpus = campaignCorpus();
    const labels = mintCampaignLabels({
      traces: corpus,
      decisionContractDigest: d('a'),
      labelBindingDigest: d('b'),
    });
    expect(labels.length).toBe(corpus.length * MAPPED_OBSERVATION_AXES.length);
    const sourceDigests = new Set(corpus.map((t) => t.candidates[0].recovery.source_digest));
    const ids = new Set<string>();
    for (const label of labels) {
      expect(() => validateSemanticCalibrationLabel(label)).not.toThrow();
      expect(label.authority).toBe('STRONG');
      expect(label.verifierIdentity).toBe(MECHANICAL_VERIFIER_ID);
      expect(sourceDigests.has(label.sourceDigest)).toBe(true);
      expect(label.decisionContractDigest).toBe(d('a'));
      expect(label.labelBindingDigest).toBe(d('b'));
      expect(ids.has(label.labelId)).toBe(false);
      ids.add(label.labelId);
    }
  });

  it('label digests change when the binding generation changes', () => {
    const corpus = campaignCorpus();
    const a = mintCampaignLabels({
      traces: corpus,
      decisionContractDigest: d('a'),
      labelBindingDigest: d('b'),
    });
    const b = mintCampaignLabels({
      traces: corpus,
      decisionContractDigest: d('a'),
      labelBindingDigest: d('c'),
    });
    expect(a[0].outcomeDigest).toBe(b[0].outcomeDigest); // outcome bound to source, not generation
    expect(a[0].labelBindingDigest).not.toBe(b[0].labelBindingDigest);
  });
});

describe('splitCampaignCorpus', () => {
  it('is deterministic, disjoint, and complete', () => {
    const corpus = campaignCorpus();
    const s1 = splitCampaignCorpus(corpus);
    const s2 = splitCampaignCorpus(corpus);
    expect(s1).toEqual(s2);
    expect(s1.training.length + s1.holdout.length).toBe(corpus.length);
    const trainIds = new Set(s1.training.map((t) => t.trace_id));
    for (const t of s1.holdout) expect(trainIds.has(t.trace_id)).toBe(false);
    // both splits must cover all five predicates in both classes for calibration
    for (const split of [s1.training, s1.holdout]) {
      const axes = new Set<string>();
      for (const t of split) {
        for (const ax of MAPPED_OBSERVATION_AXES) axes.add(ax);
      }
      expect(axes.size).toBe(MAPPED_OBSERVATION_AXES.length);
    }
  });
});

describe('corpus identity', () => {
  it('exposes a stable corpus id', () => {
    expect(CAMPAIGN_CORPUS_ID).toBe('anvil.campaign-corpus.v1');
  });
});
