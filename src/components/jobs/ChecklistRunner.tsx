'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  checklistChoiceLabel,
  checklistChoiceRequired,
  evaluateChecklist,
  isChecklistItemAnswered,
  isMeasurementOutOfRange,
  requiresNote,
  type ChecklistItem,
  type ChecklistResponse,
  type ChecklistTemplate,
  type Job,
  type PassFailNa,
} from '@/domain';
import type { ChecklistAnswer } from '@/application/job-operations';
import { Badge, Button, Card, ConfirmDialog, Icon } from '@/components/ui';
import { jobs } from '@/api/endpoints';
import { useOnline } from '@/hooks/useOnline';
import { useOfflineCapture } from '@/hooks/useOfflineCapture';
import { useOperation } from '@/hooks/useOperation';
import { usePendingWork } from '@/hooks/usePendingWork';
import { holdMedia } from '@/lib/pwa/pending-media';
import { supersedePendingAnswer, type PendingWork } from '@/lib/pwa/pending-work';
import { useApp, useCurrentUser } from '@/providers/AppProvider';
import { ApiRequestError } from '@/api/client';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import { PhotoCaptureButtons } from '@/components/media/PhotoCaptureButtons';
import { UploadFailureNotice } from '@/components/media/UploadFailureNotice';
import { cn } from '@/lib/cn';
import { RuleViolationNotice } from './RuleViolationNotice';

/**
 * One line naming the answer, for the queue a technician reads later.
 *
 * The item's own wording and the value, because "answer_checklist" tells
 * nobody which of forty questions is being held.
 */
const answerLabel = (item: ChecklistItem, response: ChecklistResponse): string => {
  switch (item.responseType) {
    case 'pass_fail_na':
      return response.choice === null ? 'no answer' : response.choice.toUpperCase();
    case 'yes_no':
      return response.yesNo === null ? 'no answer' : response.yesNo ? 'Yes' : 'No';
    case 'measurement':
      return response.measurement === null
        ? 'no reading'
        : `${response.measurement}${item.unit === null ? '' : ` ${item.unit}`}`;
    case 'text':
      return response.text.trim().length === 0 ? 'no answer' : response.text.trim().slice(0, 80);
  }
};

/**
 * Tablet-first checklist.
 *
 * Design rules applied here:
 *  - one tap answers an item; typing is only ever required for measurements and
 *    explicit text items,
 *  - targets are at least 56px high so they are usable with gloves,
 *  - a failed answer immediately reveals the notes field, because a failure
 *    always needs an explanation,
 *  - progress and outstanding items are always visible.
 */
export const ChecklistRunner = ({
  job,
  template,
  options = [],
  editable,
  onChanged,
}: {
  readonly job: Job;
  /**
   * The wording the job's checklist is on — or, for a job with none started,
   * the one checklist issued. NULL when the technician must choose first
   * (Service: Milling or Lathe); `options` are the choices. CHK-SRC-1.
   */
  readonly template: ChecklistTemplate | null;
  readonly options?: readonly ChecklistTemplate[];
  readonly editable: boolean;
  readonly onChanged: () => void;
}) => {
  if (job.checklist === null && (template === null || checklistChoiceRequired(options))) {
    return (
      <ChecklistChoice job={job} options={options} editable={editable} onChanged={onChanged} />
    );
  }
  if (template === null) return null;
  return (
    <ChecklistForm job={job} template={template} editable={editable} onChanged={onChanged} />
  );
};

/**
 * "WHICH SERVICE CHECKLIST DO YOU NEED TO COMPLETE?" CHK-SRC-1.
 *
 * Shown before a Service checklist opens, and nothing opens until one is
 * chosen: there is no default, no "skip", and no generic Service checklist.
 * The choice is sent with the start, and the server refuses a start without
 * one — this screen is the way to make it, not the rule.
 */
const ChecklistChoice = ({
  job,
  options,
  editable,
  onChanged,
}: {
  readonly job: Job;
  readonly options: readonly ChecklistTemplate[];
  readonly editable: boolean;
  readonly onChanged: () => void;
}) => {
  const operation = useOperation();
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = options.find((option) => option.id === chosen) ?? null;

  if (options.length === 0) {
    return (
      <Card>
        <p className="text-sm text-steel-600">
          No checklist is issued for this job type. The office must publish one first.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="py-2" data-testid="checklist-choice">
        <h3 className="text-lg font-semibold text-steel-900">
          {job.jobType === 'service'
            ? 'Which Service checklist do you need to complete?'
            : 'Which checklist do you need to complete?'}
        </h3>
        <p className="mt-1 text-sm text-steel-500">
          Choose one to continue. It cannot be changed once the checklist is started.
        </p>
        <fieldset className="mt-4" disabled={!editable || operation.running}>
          <legend className="sr-only">Checklist</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {options.map((option, index) => {
              const active = chosen === option.id;
              const rows = option.sections.reduce(
                (total, section) => total + section.items.length,
                0,
              );
              return (
                <label
                  key={`${option.id}-${option.version}`}
                  data-testid={`checklist-choice-${option.kind ?? option.id}`}
                  className={cn(
                    'flex min-h-20 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border-2 p-4 transition-colors',
                    active
                      ? 'border-eje-500 bg-eje-50'
                      : 'border-steel-200 bg-surface hover:border-steel-400',
                  )}
                >
                  <input
                    type="radio"
                    name={`checklist-choice-${job.id}`}
                    value={option.id}
                    checked={active}
                    onChange={() => setChosen(option.id)}
                    className="mt-1 size-5 shrink-0 accent-eje-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-steel-900">
                      {index + 1}. {checklistChoiceLabel(option)}
                    </span>
                    <span className="mt-0.5 block text-xs text-steel-500">
                      {option.layout?.title ?? option.name} · {rows} items · version{' '}
                      {option.version}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {editable ? (
          <Button
            size="lg"
            className="mt-5"
            disabled={selected === null}
            loading={operation.running}
            data-testid="checklist-choice-continue"
            onClick={async () => {
              if (selected === null) return;
              const ok = await operation.run(() => jobs.startChecklist(job.id, selected.id));
              if (ok) onChanged();
            }}
          >
            {selected === null
              ? 'Open checklist'
              : `Open the ${checklistChoiceLabel(selected)} checklist`}
          </Button>
        ) : (
          <p className="mt-5 text-sm text-steel-500">
            This checklist has not been started and the job is no longer editable.
          </p>
        )}
      </div>
    </Card>
  );
};

/** Two changes to one item, the later winning field by field (blanks merged, not replaced). */
const mergeAnswer = (earlier: ChecklistAnswer | undefined, later: ChecklistAnswer | undefined): ChecklistAnswer => {
  if (earlier === undefined) return later ?? {};
  if (later === undefined) return earlier;
  return {
    ...earlier,
    ...later,
    ...(earlier.fieldValues === undefined && later.fieldValues === undefined
      ? {}
      : { fieldValues: { ...(earlier.fieldValues ?? {}), ...(later.fieldValues ?? {}) } }),
  };
};

/** The response as the technician last set it: the stored one with their queued or just-saved answer over it. */
const withAnswer = (itemId: string, response: ChecklistResponse | undefined, value: ChecklistAnswer): ChecklistResponse => ({
  itemId,
  choice: value.choice !== undefined ? value.choice : (response?.choice ?? null),
  yesNo: value.yesNo !== undefined ? value.yesNo : (response?.yesNo ?? null),
  measurement: value.measurement !== undefined ? value.measurement : (response?.measurement ?? null),
  text: value.text !== undefined ? value.text : (response?.text ?? ''),
  notes: value.notes !== undefined ? value.notes : (response?.notes ?? ''),
  fieldValues: { ...(response?.fieldValues ?? {}), ...(value.fieldValues ?? {}) },
  photos: response?.photos ?? [],
  answeredAt: response?.answeredAt ?? null,
  answeredBy: response?.answeredBy ?? null,
});

/** "Saving...", "All answers saved", or what was not saved and a way to send it again. */
const ChecklistSaveState = ({
  state,
  unsaved,
  error,
  onRetry,
}: {
  readonly state: 'idle' | 'saving' | 'saved' | 'failed';
  readonly unsaved: number;
  readonly error: string | null;
  readonly onRetry: () => void;
}) => {
  if (state === 'idle') return null;
  if (state === 'failed') {
    return (
      <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-signal-600" data-testid="checklist-save-state" data-state="failed">
        <span>
          {unsaved} {unsaved === 1 ? 'answer is' : 'answers are'} not saved{error === null ? '.' : ` — ${error}`}
        </span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p role="status" aria-live="polite" className="mt-1 text-sm text-steel-500" data-testid="checklist-save-state" data-state={state}>
      {state === 'saving' ? 'Saving…' : 'All answers saved'}
    </p>
  );
};

/** True on the first row of a run the source labels once ("Check all oil levels:"). */
const groupStarts = (items: readonly ChecklistItem[], index: number): boolean => {
  const group = items[index]?.group ?? '';
  return group.length > 0 && (index === 0 || (items[index - 1]?.group ?? '') !== group);
};

const ChecklistForm = ({
  job,
  template,
  editable,
  onChanged,
}: {
  readonly job: Job;
  readonly template: ChecklistTemplate;
  readonly editable: boolean;
  readonly onChanged: () => void;
}) => {
  const operation = useOperation();
  const [confirmComplete, setConfirmComplete] = useState(false);

  const responses = useMemo(() => {
    const map = new Map<string, ChecklistResponse>();
    for (const response of job.checklist?.responses ?? []) map.set(response.itemId, response);
    return map;
  }, [job.checklist]);

  const started = job.checklist !== null;
  const completed = job.checklist?.completedAt !== null && job.checklist !== null;

  /*
   * ANSWERS ARE SAVED ONE AT A TIME, THE LATEST WINNING. CHK-RACE-1 (17 November 2026).
   *
   * Each tap used to send its own request at once and lock every row until it came back, so taps
   * made during a save were lost, and two saves in flight together raced on the job's version. Now
   * a tap shows at once and joins a queue: one answer is on the wire at a time, a second change to
   * the same item while it waits is MERGED into it (so "Pass, no - Fail" sends Fail, never Pass after
   * Fail), and the screen says whether everything is saved. A failed save keeps its answer queued and
   * on screen, marked unsaved, until it is sent again - nothing a technician tapped disappears
   * silently. The server re-runs an answer that lost a race with another write (answer_checklist).
   */
  const { invalidate } = useApp();
  const queued = useRef(new Map<string, ChecklistAnswer>());
  /** Answers the server REFUSED (not a lost connection): set aside with its reason, never resent blindly. */
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [lastError, setLastError] = useState<string | null>(null);
  const sending = useRef(false);
  const [unsaved, setUnsaved] = useState<ReadonlyMap<string, ChecklistAnswer>>(new Map());
  /** Each item's response as the server returned it from this screen's last save of it. */
  const [returned, setReturned] = useState<ReadonlyMap<string, ChecklistResponse>>(new Map());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const flush = async (): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setSaveState('saving');
    let failed = false;
    while (queued.current.size > 0) {
      const [itemId, value] = queued.current.entries().next().value as [string, ChecklistAnswer];
      let saved: Job;
      try {
        saved = await jobs.answerChecklist(job.id, { itemId, ...value });
        invalidate();
      } catch (error) {
        const code = error instanceof ApiRequestError ? error.code : 'internal_error';
        const message = error instanceof Error ? error.message : 'The answer could not be saved.';
        /*
         * A lost connection or a lost race is worth sending again, so the answer stays at the head of
         * the queue and the screen offers "Try again". Anything else is the server's REFUSAL of that
         * answer — sending it again would be refused again and would hold every later answer behind
         * it — so it is set aside with its reason, its row shows the stored answer again, and the
         * rest of the queue carries on.
         */
        if (code === 'network' || code === 'version_conflict' || code === 'internal_error') {
          setLastError(message);
          failed = true;
          break;
        }
        if (queued.current.get(itemId) === value) queued.current.delete(itemId);
        setRefused((current) => new Map(current).set(itemId, message));
        setUnsaved(new Map(queued.current));
        continue;
      }
      setRefused((current) => {
        if (!current.has(itemId)) return current;
        const next = new Map(current);
        next.delete(itemId);
        return next;
      });
      // Sent: off the queue unless a newer change to the same item arrived meanwhile (still queued, merged).
      if (queued.current.get(itemId) === value) queued.current.delete(itemId);
      const stored = saved.checklist?.responses.find((response) => response.itemId === itemId);
      if (stored !== undefined) setReturned((current) => new Map(current).set(itemId, stored));
      setUnsaved(new Map(queued.current));
    }
    sending.current = false;
    setUnsaved(new Map(queued.current));
    setSaveState(failed ? 'failed' : 'saved');
    if (!failed) onChanged();
  };

  const answer = (itemId: string, value: ChecklistAnswer): void => {
    queued.current.set(itemId, mergeAnswer(queued.current.get(itemId), value));
    setUnsaved(new Map(queued.current));
    setLastError(null);
    void flush();
  };

  /*
   * What a row shows: the newer of the screen's copy of the job and the response this screen's last
   * save returned (the screen refetches after a save, and until it has, the save's own answer is the
   * newer), with anything still queued over it. A later change by somebody else is newer still, and wins.
   */
  const shownResponse = (itemId: string): ChecklistResponse | undefined => {
    const held = responses.get(itemId);
    const mine = returned.get(itemId);
    const stored = mine !== undefined && (held === undefined || (mine.answeredAt ?? '') > (held.answeredAt ?? '')) ? mine : held;
    const local = unsaved.get(itemId);
    return local === undefined ? stored : withAnswer(itemId, stored, local);
  };

  /*
   * Progress and what is outstanding are counted from what the screen SHOWS — the stored answers with
   * this screen's saved and queued answers over them — so the row and the list above it never disagree
   * while an answer is on its way. Completing the checklist still waits for the queue (below), and the
   * server checks it against what it holds.
   */
  const shownChecklist =
    job.checklist === null
      ? null
      : {
          ...job.checklist,
          responses: [
            ...new Set([...job.checklist.responses.map((response) => response.itemId), ...returned.keys(), ...unsaved.keys()]),
          ]
            .map((itemId) => shownResponse(itemId))
            .filter((response): response is ChecklistResponse => response !== undefined),
        };
  const progress = evaluateChecklist(template, shownChecklist);

  /*
   * ANSWERING WITH NO SIGNAL. OFF-CHK-1.
   *
   * Online, each control writes its own field as it is tapped, which is what
   * makes the runner feel like paper. Offline that would be wrong twice over:
   * a `fail` would be held with no note (the note arrives on the next blur, as
   * a second capture), and two captures for one item would race each other on
   * the way back. So with no connection the row collects the WHOLE answer and
   * the technician holds it deliberately, and this is where it is validated
   * against the template before anything is written to the device.
   *
   * The template is in memory because the technician is looking at it. Nothing
   * here caches it, infers it or invents an answer — an item with no value is
   * refused, and so is a failure with no note.
   */
  const online = useOnline();
  const currentUser = useCurrentUser();
  const capture = useOfflineCapture(job);
  const pending = usePendingWork();

  /*
   * Back online with answers still queued (the connection dropped mid-save): they are sent now, in
   * order, rather than waiting for the next tap or for "Try again".
   */
  useEffect(() => {
    if (online && queued.current.size > 0) void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);


  const held = useMemo(() => {
    const map = new Map<string, PendingWork>();
    for (const row of pending.rows) {
      if (row.jobId !== job.id || row.action !== 'answer_checklist') continue;
      const itemId = row.payload.itemId;
      if (typeof itemId === 'string') map.set(itemId, row);
    }
    return map;
  }, [pending.rows, job.id]);

  /** Held, not saved. Returns what to tell the technician, or null if it went. */
  const hold = async (item: ChecklistItem, draft: ChecklistAnswer): Promise<string | null> => {
    const checklist = job.checklist;
    if (checklist === null) return 'The checklist has not been started on this tablet.';

    const existing = responses.get(item.id);
    const candidate: ChecklistResponse = {
      itemId: item.id,
      choice: draft.choice !== undefined ? draft.choice : (existing?.choice ?? null),
      yesNo: draft.yesNo !== undefined ? draft.yesNo : (existing?.yesNo ?? null),
      measurement:
        draft.measurement !== undefined ? draft.measurement : (existing?.measurement ?? null),
      text: draft.text !== undefined ? draft.text : (existing?.text ?? ''),
      notes: draft.notes !== undefined ? draft.notes : (existing?.notes ?? ''),
      fieldValues: { ...(existing?.fieldValues ?? {}), ...(draft.fieldValues ?? {}) },
      photos: existing?.photos ?? [],
      answeredAt: null,
      answeredBy: null,
    };

    // The template's own rules, asked before the device holds anything.
    if (!isChecklistItemAnswered(item, candidate)) {
      return 'Answer the item before this tablet can hold it.';
    }
    if (requiresNote(item, candidate) && candidate.notes.trim().length === 0) {
      return 'This item was not passed, so the note has to be written before it can be held.';
    }

    // One answer per item: the unsent one this replaces is the same answer,
    // corrected. Nothing that reached the server is touched — see the store.
    await supersedePendingAnswer(currentUser?.id ?? '', job.id, item.id).catch(() => 0);
    // CHK-RACE-1: and an online answer to this item still queued from before the connection dropped is
    // superseded too — it must never be sent later over the answer held now.
    if (queued.current.delete(item.id)) setUnsaved(new Map(queued.current));

    const outcome = await capture.capture(
      'answer_checklist',
      {
        itemId: item.id,
        choice: candidate.choice,
        yesNo: candidate.yesNo,
        measurement: candidate.measurement,
        text: candidate.text,
        notes: candidate.notes,
        fieldValues: candidate.fieldValues,
        /*
         * WHAT THIS ANSWER IS AN ANSWER TO. The instance it was given on, and
         * the answer it replaces. The server refuses the capture if either has
         * moved on, so a stale answer is referred to the office rather than
         * overwriting somebody else's (`ChecklistExpectation`).
         */
        templateId: checklist.templateId,
        templateVersion: checklist.templateVersion,
        expectedAnsweredAt: existing?.answeredAt ?? null,
      },
      `${item.text} — ${answerLabel(item, candidate)}`,
    );

    if (outcome.kind === 'refused') return outcome.message;
    if (outcome.kind === 'sent') onChanged();
    await pending.refresh();
    return null;
  };

  /*
   * EVIDENCE GOES UP AS BYTES. CHK-EVIDENCE-1.
   *
   * One uploader for the whole runner rather than one per row: a technician
   * attaches evidence to one item at a time, and a single in-flight capture is
   * what keeps the retry unambiguous — the failure notice can only ever be
   * about the photograph that just failed. `capturingFor` is what the row uses
   * to show its own spinner rather than every row showing one.
   */
  const [capturingFor, setCapturingFor] = useState<string | null>(null);
  /*
   * THE ITEM ID TRAVELS WITH THE FILE, not through state.
   *
   * It was read from `capturingFor` inside the uploader at first, and that was
   * a stale-closure bug with teeth: the id was set and the send started in the
   * same tick, so the uploader still saw `null` and posted to a URL with no
   * item in it. The id is part of the capture, so it is passed as the capture's
   * context — which also means a RETRY cannot drift onto another item.
   */
  const evidence = usePhotoUpload<string>(
    (file, idempotencyKey, itemId) =>
      jobs.addChecklistPhoto(job.id, itemId, file, { idempotencyKey }),
    /*
     * AND IT IS KEPT WHEN IT CANNOT BE SENT. OFF-MEDIA-1.
     *
     * Evidence was online-only because the queue carries requests and this is
     * bytes — so it got its own store rather than being forced into that one.
     * The item id travels WITH the capture, exactly as it does on the way up,
     * which is what stops a held photograph drifting onto another question.
     */
    async (file, idempotencyKey, itemId) => {
      const outcome = await holdMedia({
        userId: currentUser?.id ?? '',
        jobId: job.id,
        jobNumber: job.jobNumber,
        destination: { kind: 'checklist_evidence', itemId },
        file,
        caption: '',
        idempotencyKey,
      });
      return outcome.held;
    },
  );
  const captureEvidence = async (itemId: string, file: File) => {
    setCapturingFor(itemId);
    const ok = await evidence.send(file, itemId);
    if (ok) {
      setCapturingFor(null);
      onChanged();
    }
  };

  if (!started) {
    return (
      <Card>
        <div className="flex flex-col items-center py-8 text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-eje-50 text-eje-600">
            <Icon name="check" className="size-7" />
          </span>
          <h3 className="text-lg font-semibold text-steel-900">{template.name}</h3>
          <p className="mt-2 max-w-md text-sm text-steel-500">{template.description}</p>
          <p className="mt-3 text-xs text-steel-400">
            Version {template.version} · {progress.total} items
          </p>
          {editable ? (
            <Button
              size="lg"
              className="mt-6"
              loading={operation.running}
              onClick={async () => {
                const ok = await operation.run(() => jobs.startChecklist(job.id));
                if (ok) onChanged();
              }}
            >
              Start checklist
            </Button>
          ) : (
            <p className="mt-6 text-sm text-steel-500">
              This checklist has not been started and the job is no longer editable.
            </p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="sticky top-20 z-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-steel-900">{template.name}</h3>
              {(template.selectionLabel ?? '').length > 0 && (
                <span data-testid="checklist-kind">
                  <Badge tone="blue" size="sm">
                    {template.selectionLabel}
                  </Badge>
                </span>
              )}
              <Badge tone={template.status === 'archived' ? 'amber' : 'neutral'} size="sm">
                Version {template.version}
              </Badge>
              {completed && (
                <Badge tone="green" size="sm" dot>
                  Completed
                </Badge>
              )}
            </div>
            {template.layout != null && (
              <p className="mt-0.5 text-xs font-semibold tracking-wide text-steel-500">
                {template.layout.title}
              </p>
            )}
            <ChecklistSaveState
              state={saveState}
              unsaved={unsaved.size}
              error={lastError}
              onRetry={() => void flush()}
            />
            {refused.size > 0 && (
              <ul role="alert" className="mt-1 space-y-0.5 text-sm font-medium text-signal-600" data-testid="checklist-refused">
                {[...refused.entries()].map(([itemId, message]) => (
                  <li key={itemId}>
                    {template.sections.flatMap((section) => section.items).find((item) => item.id === itemId)?.text ?? 'An answer'}: not saved — {message}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-sm text-steel-500">
              {progress.answered} of {progress.total} answered
              {progress.failedItems > 0 && (
                <span className="font-semibold text-signal-600">
                  {' '}
                  · {progress.failedItems} failed
                </span>
              )}
            </p>
          </div>
          <div className="tabular text-2xl font-bold text-steel-900">
            {progress.percentComplete}%
          </div>
        </div>
        {template.status === 'archived' && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-eje-700">
            <Icon name="warning" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This checklist is on version {template.version}, which has since been superseded.
              It is shown exactly as it was answered. New checklists use the current version.
            </span>
          </p>
        )}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-steel-100">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              progress.complete ? 'bg-verdant-500' : 'bg-eje-500',
            )}
            style={{ width: `${progress.percentComplete}%` }}
          />
        </div>
      </Card>

      {/*
        WHAT THE PERCENTAGE ABOVE IS, AND IS NOT. OFF-CHK-1. It counts what the
        SERVER holds. A held answer is not on the job yet and is not counted
        here, because a progress bar that includes work nobody has received is
        how a technician comes to believe a checklist is finished when it is
        not.
      */}
      {!online && (
        <Card>
          <p
            className="text-sm font-semibold text-amber-eje-800"
            data-testid="checklist-offline-notice"
          >
            No connection to the EJE server.
          </p>
          <p className="mt-1 text-sm text-steel-600">
            Answer each item and tap <strong>Hold answer</strong>. Answers are kept on this tablet
            under your name and sent when there is a signal — they are not on the job, and are not
            counted in the progress above. Evidence photographs and completing the checklist both
            need a connection.
          </p>
        </Card>
      )}

      {template.sections.map((section, sectionIndex) => (
        <Card key={section.id} padded={false}>
          {(section.title.length > 0 || section.description.length > 0) && (
            <header className="border-b border-steel-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                {/* A source document numbers its own rows; its sections are named, not numbered. */}
                {template.layout == null && (
                  <span className="tabular flex size-7 items-center justify-center rounded-full bg-steel-900 text-xs font-bold text-white">
                    {sectionIndex + 1}
                  </span>
                )}
                <h4 className="text-sm font-semibold text-steel-900">{section.title}</h4>
              </div>
              {section.description.length > 0 && (
                <p className="mt-1.5 pl-9 text-sm text-steel-500">{section.description}</p>
              )}
            </header>
          )}

          <ul className="divide-y divide-steel-100">
            {section.items.map((item, itemIndex) => (
              <ChecklistItemRow
                key={item.id}
                groupHeading={groupStarts(section.items, itemIndex)}
                item={item}
                response={shownResponse(item.id)}
                editable={editable && !completed}
                busy={capture.running}
                onAnswer={(value) => answer(item.id, value)}
                offline={!online}
                held={held.get(item.id)}
                sendingAnswer={(() => {
                  const row = held.get(item.id);
                  return row !== undefined && pending.sending.includes(row.id);
                })()}
                onHold={(draft) => hold(item, draft)}
                jobId={job.id}
                onCapture={(file) => void captureEvidence(item.id, file)}
                uploading={evidence.state === 'uploading' && capturingFor === item.id}
                failed={evidence.state === 'failed' && capturingFor === item.id}
              />
            ))}
          </ul>
        </Card>
      ))}

      {/*
        HELD, NOT FAILED, AND THE DIFFERENCE IS THE WHOLE POINT. OFF-MEDIA-1.
        One says "take it again", the other says "carry on". The queue panel
        above the tabs is where it is listed and sent from.
      */}
      {evidence.state === 'held' && (
        <Card>
          <p className="text-sm font-semibold text-amber-eje-800" data-testid="evidence-held">
            The evidence photograph is kept on this tablet.
          </p>
          <p className="mt-1 text-sm text-steel-600">
            It is NOT on the job yet and does not satisfy the question that requires it until the
            server has it. It is sent when there is a signal.
          </p>
        </Card>
      )}

      {evidence.state === 'failed' && (
        <UploadFailureNotice
          message={evidence.error ?? 'The photograph could not be attached.'}
          fileName={evidence.fileName}
          attempts={evidence.attempts}
          busy={false}
          onRetry={() => {
            void evidence.retry().then((ok) => {
              if (ok) {
                setCapturingFor(null);
                onChanged();
              }
            });
          }}
          onDismiss={() => {
            evidence.dismiss();
            setCapturingFor(null);
          }}
        />
      )}

      {!progress.complete && (
        <RuleViolationNotice
          title={`${progress.issues.length} ${progress.issues.length === 1 ? 'item is' : 'items are'} outstanding`}
          violations={progress.issues.map((issue) => ({
            code: `${issue.itemId}-${issue.reason}`,
            message: issue.message,
          }))}
        />
      )}

      {editable && !completed && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-steel-900">Finish the checklist</p>
              <p className="mt-0.5 text-sm text-steel-500">
                {!online
                  ? 'Completing the checklist is checked against the template on the server, so it needs a connection.'
                  : progress.complete
                    ? 'Every required item has been answered.'
                    : 'All required items must be answered before the checklist can be completed.'}
              </p>
            </div>
            <Button
              size="lg"
              variant="success"
              // Not while an answer is still on its way: the checklist is completed as the SERVER holds it.
              disabled={!progress.complete || !online || unsaved.size > 0 || saveState === 'saving'}
              onClick={() => setConfirmComplete(true)}
            >
              Complete checklist
            </Button>
          </div>
        </Card>
      )}

      {template.layout != null &&
        (template.layout.notes.length > 0 || template.layout.closing.length > 0) && (
          <Card>
            {template.layout.notes.map((note) => (
              <p key={note} className="text-sm text-steel-700">
                {note}
              </p>
            ))}
            {template.layout.closing.length > 0 && (
              <p className="mt-2 text-sm font-bold tracking-wide text-steel-900">
                {template.layout.closing}
              </p>
            )}
          </Card>
        )}

      {template.layout != null && (
        <p className="px-1 text-xs text-steel-500">
          {template.layout.signatures.map((signature) => signature.label).join(' · ')}: the
          engineer and the customer sign on the job card that carries this checklist.
        </p>
      )}

      <p className="px-1 text-xs text-steel-400" data-testid="checklist-source">
        {template.kind == null
          ? `Earlier demonstration wording, not an EJE source document. Source: ${template.sourceDocument}`
          : `Source: ${template.sourceDocument}`}
      </p>

      <ConfirmDialog
        open={confirmComplete}
        title="Complete this checklist?"
        message={
          <>
            <p>
              {template.name} ({template.version}) will be marked as complete and attached to{' '}
              {job.jobNumber}.
            </p>
            {progress.failedItems > 0 && (
              <p className="mt-2 font-semibold text-signal-600">
                {progress.failedItems} {progress.failedItems === 1 ? 'item' : 'items'} recorded as
                failed. These will appear on the customer job card.
              </p>
            )}
          </>
        }
        confirmLabel="Complete checklist"
        confirmVariant="success"
        busy={operation.running}
        onConfirm={async () => {
          const ok = await operation.run(() => jobs.completeChecklist(job.id));
          setConfirmComplete(false);
          if (ok) onChanged();
        }}
        onCancel={() => setConfirmComplete(false)}
      />
    </div>
  );
};

const ChecklistItemRow = ({
  item,
  groupHeading = false,
  response,
  editable,
  busy,
  jobId,
  onAnswer,
  offline,
  held,
  sendingAnswer,
  onHold,
  onCapture,
  uploading,
  failed: uploadFailed,
}: {
  readonly item: ChecklistItem;
  /** True on the first row of a group the source labels once ("Check all oil levels:"). */
  readonly groupHeading?: boolean;
  readonly response: ChecklistResponse | undefined;
  readonly editable: boolean;
  readonly busy: boolean;
  /** For the authenticated media route each thumbnail is read through. */
  readonly jobId: string;
  readonly onAnswer: (value: ChecklistAnswer) => void;
  /** No connection: collect the whole answer and hold it. OFF-CHK-1. */
  readonly offline: boolean;
  /** An answer this tablet is holding for this item, if there is one. */
  readonly held: PendingWork | undefined;
  /** True while this item's held answer is being sent. OFF-8. */
  readonly sendingAnswer: boolean;
  readonly onHold: (draft: ChecklistAnswer) => Promise<string | null>;
  readonly onCapture: (file: File) => void;
  readonly uploading: boolean;
  readonly failed: boolean;
}) => {
  const [measurement, setMeasurement] = useState(
    response?.measurement === null || response?.measurement === undefined
      ? ''
      : String(response.measurement),
  );
  const [text, setText] = useState(response?.text ?? '');
  const [notes, setNotes] = useState(response?.notes ?? '');
  const [fieldValues, setFieldValues] = useState<Readonly<Record<string, string>>>(
    response?.fieldValues ?? {},
  );
  /*
   * THE ANSWER THIS ROW IS COLLECTING WHILE THERE IS NO SIGNAL. OFF-CHK-1.
   *
   * Online every control writes as it is tapped. Offline nothing is written
   * until the technician holds it, so the taps have to live somewhere — and it
   * has to be somewhere that is visibly NOT the server's answer, which is why
   * the row shows the two apart.
   */
  const [draft, setDraft] = useState<ChecklistAnswer>({});
  const [holdError, setHoldError] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);

  /** What the technician has typed or tapped but not yet held. */
  const pendingDraft = offline && Object.keys(draft).length > 0;

  const commit = (value: ChecklistAnswer) => {
    if (offline) {
      setDraft((current) => ({
        ...current,
        ...value,
        ...(value.fieldValues === undefined
          ? {}
          : { fieldValues: { ...(current.fieldValues ?? {}), ...value.fieldValues } }),
      }));
      setHoldError(null);
      return;
    }
    onAnswer(value);
  };

  const shown: ChecklistResponse = {
    itemId: item.id,
    choice: draft.choice !== undefined ? draft.choice : (response?.choice ?? null),
    yesNo: draft.yesNo !== undefined ? draft.yesNo : (response?.yesNo ?? null),
    measurement:
      draft.measurement !== undefined ? draft.measurement : (response?.measurement ?? null),
    text: draft.text !== undefined ? draft.text : (response?.text ?? ''),
    notes: draft.notes !== undefined ? draft.notes : (response?.notes ?? ''),
    fieldValues: { ...(response?.fieldValues ?? {}), ...(draft.fieldValues ?? {}) },
    photos: response?.photos ?? [],
    answeredAt: response?.answeredAt ?? null,
    answeredBy: response?.answeredBy ?? null,
  };

  const failed =
    (item.responseType === 'pass_fail_na' && shown.choice === 'fail') ||
    (item.responseType === 'yes_no' && shown.yesNo === false);
  const outOfRange = isMeasurementOutOfRange(item, shown);
  const photoMissing = item.photoRequired && (response?.photos.length ?? 0) === 0;
  const noteRequired = requiresNote(item, shown);
  const noteMissing = noteRequired && shown.notes.trim().length === 0;

  const hold = async () => {
    setHolding(true);
    try {
      const problem = await onHold(draft);
      setHoldError(problem);
      if (problem === null) setDraft({});
    } finally {
      setHolding(false);
    }
  };

  return (
    /*
      The item's own id on its row, so a browser test can answer and hold ONE
      named question rather than whichever happens to be first — which is what
      a conflict test needs: the office has to change the same item the tablet
      is holding.
    */
    <li
      data-testid={`checklist-item-${item.id}`}
      className={cn('px-5 py-4', failed && 'bg-signal-50/40')}
    >
      {groupHeading && (
        <p className="mb-2 flex gap-2 text-sm font-semibold text-steel-900" data-testid="checklist-group">
          <span className="tabular w-6 shrink-0 text-steel-500">{item.number}</span>
          {item.group}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex gap-2 text-sm font-medium text-steel-900">
            {/* The source's own number; a grouped row's number is on its group heading. */}
            {(item.number !== undefined || (item.group ?? '').length > 0) && (
              <span className="tabular w-6 shrink-0 text-steel-500" data-testid="checklist-number">
                {(item.group ?? '').length > 0 ? '' : item.number}
              </span>
            )}
            <span className="whitespace-pre-line">
              {item.text}
              {item.required && <span className="ml-1 text-signal-500">*</span>}
            </span>
          </p>
          {(item.sourceNote ?? '').length > 0 && (
            <p
              className="mt-1 ml-8 inline-block rounded bg-amber-eje-50 px-1.5 py-0.5 text-xs font-medium text-amber-eje-800"
              data-testid="checklist-source-note"
            >
              {item.sourceNote}
            </p>
          )}
          {item.helpText.length > 0 && (
            <p className="mt-0.5 text-xs text-steel-500">{item.helpText}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/*
            HELD IS NOT ANSWERED. OFF-CHK-1. The badge is the only honest way
            to show a row whose answer is on the tablet and not on the job:
            the server's copy still says whatever it said.
          */}
          {held !== undefined && (
            <span data-testid={`checklist-held-${item.id}`}>
              {/*
                SENDING IS ITS OWN STATE. OFF-CHK-1, OFF-8.

                Held, being sent, and with the office are three different
                things to a technician standing at the machine: the first is
                theirs to finish, the second needs nothing from them, and the
                third is somebody else's to answer. One word each.
              */}
              <Badge tone={sendingAnswer ? 'blue' : 'amber'} size="sm">
                {held.state === 'referred'
                  ? 'With the office'
                  : sendingAnswer
                    ? 'Sending…'
                    : 'Held on this tablet'}
              </Badge>
            </span>
          )}
          {item.photoRequired && (
            <Badge tone={photoMissing ? 'amber' : 'green'} size="sm">
              <Icon name="camera" className="size-3" />
              Photo
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3">
        {item.responseType === 'pass_fail_na' && (
          <ChoiceButtons
            value={shown.choice}
            disabled={!editable}
            onChange={(choice) => commit({ choice })}
          />
        )}

        {item.responseType === 'yes_no' && (
          <YesNoButtons
            value={shown.yesNo}
            disabled={!editable}
            onChange={(yesNo) => commit({ yesNo })}
          />
        )}

        {item.responseType === 'measurement' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <label className="mb-1.5 block text-xs font-semibold text-steel-600">
                Measured value{item.unit !== null && ` (${item.unit})`}
              </label>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={measurement}
                disabled={!editable || busy}
                onChange={(event) => setMeasurement(event.target.value)}
                onBlur={() => {
                  const parsed = Number.parseFloat(measurement);
                  commit({ measurement: Number.isFinite(parsed) ? parsed : null });
                }}
                className={cn(
                  'tabular h-14 w-full rounded-[var(--radius-control)] border px-3 text-lg font-semibold',
                  'focus:ring-2 focus:ring-eje-100 focus:outline-none disabled:bg-steel-50',
                  outOfRange
                    ? 'border-signal-400 bg-signal-50 text-signal-700'
                    : 'border-steel-300 text-steel-900 focus:border-eje-500',
                )}
              />
            </div>
            {item.expectedRange !== null && (
              <p
                className={cn(
                  'pb-4 text-xs font-medium',
                  outOfRange ? 'text-signal-600' : 'text-steel-500',
                )}
              >
                {outOfRange ? 'Outside the expected range: ' : 'Expected: '}
                {item.expectedRange.min} – {item.expectedRange.max}
                {item.unit !== null && ` ${item.unit}`}
              </p>
            )}
          </div>
        )}

        {(item.fields ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3" data-testid="checklist-fields">
            {(item.fields ?? []).map((field) => (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs font-semibold text-steel-600">
                  {[field.label, field.unit].filter((part) => part.length > 0).join(' ')}
                  <span className="ml-1 font-normal text-steel-400">optional</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fieldValues[field.id] ?? ''}
                  disabled={!editable || busy}
                  onChange={(event) =>
                    setFieldValues((current) => ({ ...current, [field.id]: event.target.value }))
                  }
                  onBlur={() => {
                    const value = (fieldValues[field.id] ?? '').trim();
                    if (value === (response?.fieldValues?.[field.id] ?? '')) return;
                    commit({ fieldValues: { [field.id]: value } });
                  }}
                  data-testid={`checklist-field-${item.id}-${field.id}`}
                  className="tabular h-12 w-32 rounded-[var(--radius-control)] border border-steel-300 px-3 text-base focus:border-eje-500 focus:ring-2 focus:ring-eje-100 focus:outline-none disabled:bg-steel-50"
                />
              </label>
            ))}
          </div>
        )}

        {item.responseType === 'text' && (
          <textarea
            rows={2}
            value={text}
            disabled={!editable || busy}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => commit({ text })}
            placeholder="Type your answer"
            className="w-full rounded-[var(--radius-control)] border border-steel-300 px-3 py-2.5 text-sm focus:border-eje-500 focus:ring-2 focus:ring-eje-100 focus:outline-none disabled:bg-steel-50"
          />
        )}
      </div>

      {/* A note field on EVERY item. Only a finding makes it compulsory. */}
      <div className="mt-3">
        <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-steel-600">
          Note
          {noteRequired ? (
            <span className="font-bold text-signal-600">Required — explain the finding</span>
          ) : (
            <span className="font-normal text-steel-400">Optional</span>
          )}
        </label>
        <textarea
          rows={2}
          value={notes}
          disabled={!editable || busy}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => commit({ notes })}
          placeholder={
            noteRequired
              ? 'What was found, and what is recommended?'
              : 'Anything worth recording (optional)'
          }
          aria-invalid={noteMissing}
          className={cn(
            'w-full rounded-[var(--radius-control)] border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:bg-steel-50',
            noteMissing
              ? 'border-signal-400 bg-signal-50 focus:border-signal-500 focus:ring-signal-100'
              : 'border-steel-300 focus:border-eje-500 focus:ring-eje-100',
          )}
        />
        {noteMissing && (
          <p className="mt-1 text-xs font-medium text-signal-600">
            This item was not passed, so a note is required before the checklist can be
            completed.
          </p>
        )}
      </div>

      {/* -- holding the answer, with no signal. OFF-CHK-1 ------------------ */}
      {offline && editable && (
        <div className="mt-3 space-y-2">
          {held !== undefined && (
            <p className="text-xs text-steel-500" data-testid={`checklist-held-note-${item.id}`}>
              {held.state === 'referred'
                ? 'The office has this answer and is deciding what happens to it.'
                : `Held: ${held.summary}. It is on this tablet, not on the job, and is sent when there is a signal.`}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!pendingDraft || busy}
            loading={holding}
            onClick={() => void hold()}
            data-testid={`checklist-hold-${item.id}`}
          >
            {held === undefined ? 'Hold answer' : 'Replace held answer'}
          </Button>
          {holdError !== null && (
            <p role="alert" className="text-xs font-semibold text-signal-600">
              {holdError}
            </p>
          )}
          {pendingDraft && holdError === null && (
            <p className="text-xs font-medium text-amber-eje-700">
              Not held yet — tap Hold answer, or it stays on this screen only.
            </p>
          )}
        </div>
      )}

      {/* Evidence a row holds is shown even where the row does not require it. */}
      {(item.photoRequired || (response?.photos ?? []).length > 0) && (
        <div className="mt-3 space-y-2">
          {/*
            THE EVIDENCE, AS EVIDENCE. CHK-EVIDENCE-1.
            It used to be a green chip bearing the file name the client had
            invented, over a storage key with nothing behind it. These are the
            photographs, read back through the authenticated media route — so
            the technician can see that the frame is the thing the question
            asks about before the checklist is completed on it.
          */}
          {(response?.photos ?? []).length > 0 && (
            <ul className="flex flex-wrap gap-2" data-testid="checklist-evidence">
              {(response?.photos ?? []).map((photo) => (
                <li key={photo.id}>
                  <EvidenceThumbnail jobId={jobId} photo={photo} />
                </li>
              ))}
            </ul>
          )}
          {editable && item.photoRequired && (
            <div className="flex flex-wrap items-center gap-2">
              <PhotoCaptureButtons
                size="sm"
                testIdPrefix={`checklist-photo-${item.id}`}
                cameraLabel="Take evidence photo"
                galleryLabel="Choose photo"
                disabled={busy}
                busy={uploading}
                onFile={onCapture}
              />
              {/*
                EVIDENCE IS BYTES, AND IT HAS ITS OWN STORE NOW. OFF-MEDIA-1.
                The answer goes in the capture queue; the photograph's bytes go
                in the media queue, and both say they are on the tablet rather
                than on the job.
              */}
              {offline && (
                <span className="text-xs font-medium text-amber-eje-700">
                  Kept on this tablet until there is a signal — not on the job yet.
                </span>
              )}
              {uploading && (
                <span className="text-xs font-medium text-steel-500">
                  Uploading to the EJE server…
                </span>
              )}
              {uploadFailed && (
                <span className="text-xs font-semibold text-signal-600">
                  Not attached — see below.
                </span>
              )}
            </div>
          )}
          {(response?.photos ?? []).length === 0 && !uploading && (
            <p className="text-xs text-steel-500">
              This item needs a photograph before the checklist can be completed.
            </p>
          )}
        </div>
      )}
    </li>
  );
};

const CHOICES: readonly { value: PassFailNa; label: string; tone: string }[] = [
  { value: 'pass', label: 'Pass', tone: 'verdant' },
  { value: 'fail', label: 'Fail', tone: 'signal' },
  { value: 'na', label: 'N/A', tone: 'steel' },
];

const ChoiceButtons = ({
  value,
  disabled,
  onChange,
}: {
  readonly value: PassFailNa | null;
  readonly disabled: boolean;
  readonly onChange: (choice: PassFailNa) => void;
}) => (
  <div className="grid max-w-md grid-cols-3 gap-2">
    {CHOICES.map((choice) => {
      const active = value === choice.value;
      return (
        <button
          key={choice.value}
          type="button"
          disabled={disabled}
          aria-pressed={active}
          onClick={() => onChange(choice.value)}
          className={cn(
            'h-14 rounded-[var(--radius-control)] border-2 text-sm font-bold transition-colors disabled:opacity-60',
            active && choice.tone === 'verdant' && 'border-verdant-500 bg-verdant-500 text-white',
            active && choice.tone === 'signal' && 'border-signal-500 bg-signal-500 text-white',
            active && choice.tone === 'steel' && 'border-steel-500 bg-steel-500 text-white',
            !active && 'border-steel-200 bg-surface text-steel-600 hover:border-steel-400',
          )}
        >
          {choice.label}
        </button>
      );
    })}
  </div>
);

const YesNoButtons = ({
  value,
  disabled,
  onChange,
}: {
  readonly value: boolean | null;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) => (
  <div className="grid max-w-xs grid-cols-2 gap-2">
    {[
      { label: 'Yes', flag: true },
      { label: 'No', flag: false },
    ].map((option) => {
      const active = value === option.flag;
      return (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          aria-pressed={active}
          onClick={() => onChange(option.flag)}
          className={cn(
            'h-14 rounded-[var(--radius-control)] border-2 text-sm font-bold transition-colors disabled:opacity-60',
            active
              ? 'border-action bg-action text-white'
              : 'border-steel-200 bg-surface text-steel-600 hover:border-steel-400',
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

/**
 * One piece of checklist evidence, or an honest admission there are no bytes.
 *
 * Every row captured before CHK-EVIDENCE-1 has a storage key with nothing
 * behind it, and the authenticated route answers 404 for those — so the tile
 * falls back to naming the file rather than showing a broken image. A
 * placeholder is only dishonest when it is indistinguishable from a
 * photograph, which is exactly what the old green chip was.
 */
const EvidenceThumbnail = ({
  jobId,
  photo,
}: {
  readonly jobId: string;
  readonly photo: { readonly id: string; readonly fileName: string; readonly caption: string };
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-steel-100 px-2.5 py-1.5 text-xs font-medium text-steel-500"
        title="This record has no stored file."
      >
        <Icon name="camera" className="size-3.5" />
        {photo.fileName}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not an optimisable asset: the optimiser would fetch it server-side without the session cookie */
    <img
      src={jobs.mediaUrl(jobId, photo.id)}
      alt={photo.caption.length > 0 ? photo.caption : photo.fileName}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-20 rounded-[var(--radius-control)] border border-steel-200 object-cover"
      data-testid="checklist-evidence-thumbnail"
    />
  );
};
