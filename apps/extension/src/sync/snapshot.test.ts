import { snapshotRequestSchema, type NormalizedEntity } from '@campuswatch/contracts';
import { describe, expect, it } from 'vitest';
import { createHarness, type FakeAdapter } from '../test/harness.js';

const GRADE: NormalizedEntity = {
  entityType: 'grade_course',
  externalKey: '2025-2026|1|CS101|',
  payload: { courseCode: 'CS101', totalScore: 7.9 },
  fingerprint: 'a'.repeat(64),
};

async function connected() {
  const harness = createHarness();
  await harness.controller.handle({
    type: 'register',
    email: 'snap@example.edu',
    password: 'a long enough password',
  });
  (harness.adapter as FakeAdapter).entities = { grades: [GRADE] };
  await harness.controller.handle({ type: 'connect' });
  return harness;
}

describe('snapshot sync', () => {
  it('collects every source and uploads one valid snapshot when logged in', async () => {
    const { backend, state } = await connected();

    expect(backend.snapshots).toHaveLength(1);
    const snapshot = snapshotRequestSchema.parse(backend.snapshots[0]);
    expect(snapshot.sources.map((source) => source.source)).toEqual([
      'grades',
      'tuition',
      'timetable',
      'exams',
      'dashboardNotices',
    ]);
    expect(snapshot.sources[0]).toEqual({ source: 'grades', status: 'ok', entities: [GRADE] });
    expect((await state.getConnection())?.lastSyncAt).not.toBeNull();
    // A logged-in run uploads a snapshot instead of a separate probe report.
    expect(backend.calls.some((call) => call.endsWith('/probe'))).toBe(false);
  });

  it('uploads the sources that worked and reports drift in the others', async () => {
    const harness = await connected();
    const adapter = harness.adapter as FakeAdapter;
    adapter.failures = {
      tuition: Object.assign(new Error('drift'), { detail: 'tuition: summary columns changed' }),
    };

    await harness.engine.run('alarm');

    const snapshot = harness.backend.snapshots.at(-1)!;
    expect(snapshot.sources.find((source) => source.source === 'tuition')).toEqual({
      source: 'tuition',
      status: 'error',
      errorCode: 'ADAPTER_NEEDS_UPDATE',
      errorDetail: 'tuition: summary columns changed',
    });
    expect(snapshot.sources.find((source) => source.source === 'grades')?.status).toBe('ok');
    expect((await harness.state.getSync()).lastResult).toBe('adapter_needs_update');
  });

  it('never forwards unsafe error details', async () => {
    const harness = await connected();
    (harness.adapter as FakeAdapter).failures = {
      exams: Object.assign(new Error('drift'), { detail: '<td>Nguyễn Văn A 8,5</td>' }),
    };

    await harness.engine.run('alarm');

    const exams = harness.backend.snapshots.at(-1)!.sources.find((s) => s.source === 'exams');
    expect(exams).toMatchObject({ status: 'error', errorDetail: 'collector error' });
  });

  it('stops reading pages once the session ends mid-run', async () => {
    const harness = await connected();
    (harness.adapter as FakeAdapter).failures = { tuition: new Error('login') };

    await harness.engine.run('alarm');

    const snapshot = harness.backend.snapshots.at(-1)!;
    expect(snapshot.sources.map((source) => source.source)).toEqual(['grades', 'tuition']);
    expect(await harness.state.getSync()).toMatchObject({
      lastResult: 'login_required',
      polling: 'stopped',
    });
  });

  it('queues the latest snapshot while offline and uploads it on the next run', async () => {
    const harness = await connected();
    harness.backend.setOffline(true);
    await harness.engine.run('alarm');
    await harness.engine.run('manual');

    const queued = await harness.outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload.kind).toBe('snapshot');

    harness.backend.setOffline(false);
    harness.clock.advanceMinutes(5);
    const uploadsBefore = harness.backend.snapshots.length;
    await harness.engine.run('alarm');
    // The queued snapshot and this run's snapshot.
    expect(harness.backend.snapshots.length).toBe(uploadsBefore + 2);
    expect(await harness.outbox.list()).toEqual([]);
  });

  it('returns recent changes to the popup', async () => {
    const { controller, backend, state } = await connected();
    backend.changes.push({
      id: '00000000-0000-4000-8000-0000000000aa',
      connectionId: (await state.getConnection())!.id,
      entityType: 'grade_course',
      externalKey: GRADE.externalKey,
      kind: 'UPDATED',
      changedFields: [{ field: 'totalScore', before: 7.9, after: 8.4 }],
      payload: { courseCode: 'CS101', totalScore: 8.4 },
      createdAt: '2026-11-11T08:00:00.000Z',
    });

    const result = await controller.handle({ type: 'getChanges' });

    expect(result.ok && result.changes).toHaveLength(1);
  });
});
