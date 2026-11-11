import {
  assignableRoles,
  asUserId,
  can,
  deriveInitials,
  canSetTimesheetRequired,
  findEmailClash,
  formAwaits,
  manageUserRefusal,
  roleLabel,
  userFullName,
  type User,
  type UserRole,
} from '@/domain';
import type { OperationContext } from './context';
import { audit } from './audit';
import { WorkflowError } from './errors';
import { holdFormLock } from './form-locks';
import { sanitiseDocumentName } from '@/lib/payroll-files';

/**
 * User administration.
 *
 * Two rules shape everything here. A Master manages technicians and other
 * non-Master accounts but never another Master. And a user who leaves EJE is
 * disabled, never deleted: historical job cards and the audit trail must keep
 * naming the person who actually did the work.
 */
export interface NewUserInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly mobile: string;
  readonly jobTitle: string;
  readonly role: UserRole;
}

/**
 * Whether this person administers user accounts at all.
 *
 * A capability rather than a role test, because the office administers
 * technicians and a Master administers the office. WHICH accounts each may
 * touch is `assertManages` below — this only refuses somebody who has no
 * business on the Users screen at all.
 */
const assertManagesUsers = (context: OperationContext): void => {
  if (can(context.actor.role, 'users.manageTechnicians')) return;
  throw new WorkflowError('Only the office can manage user accounts.', [
    { code: 'not_permitted', message: 'User administration is an office function.' },
  ]);
};

const assertManages = (context: OperationContext, target: User): void => {
  const refusal = manageUserRefusal(context.actor, target);
  if (refusal === null) return;
  throw new WorkflowError(refusal, [
    {
      code: 'master_not_editable',
      message: `${userFullName(target)} is a Senior Tech account and is not editable from here.`,
    },
  ]);
};

const required = (value: string, code: string, message: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new WorkflowError(message, [{ code, message }]);
  return trimmed;
};

const assertEmailFree = async (
  context: OperationContext,
  email: string,
  excludingId?: string,
): Promise<void> => {
  const users = await context.repos.users.list();
  const clash = findEmailClash(users, email, excludingId);
  if (clash === null) return;
  throw new WorkflowError(`${clash.email} is already used by ${userFullName(clash)}.`, [
    { code: 'duplicate_email', message: 'Each user needs their own email address to sign in.' },
  ]);
};

export const createUser = async (
  context: OperationContext,
  input: NewUserInput,
): Promise<User> => {
  assertManagesUsers(context);

  // Nobody mints a Master from here — that is a change to the office itself —
  // and a Coordinator creates technicians only, so she cannot promote herself
  // by creating an account and signing in as it.
  if (!assignableRoles(context.actor.role).includes(input.role)) {
    throw new WorkflowError(
      input.role === 'master'
        ? 'A Senior Tech account cannot be created from here.'
        : `A ${roleLabel(context.actor.role)} cannot create a ${roleLabel(input.role)} account.`,
      [
        {
          code: 'role_not_assignable',
          message: `You can create: ${assignableRoles(context.actor.role)
            .map((role) => roleLabel(role))
            .join(', ')}.`,
        },
      ],
    );
  }

  const firstName = required(input.firstName, 'first_name_required', 'A first name is required.');
  const lastName = required(input.lastName, 'last_name_required', 'A surname is required.');
  const email = required(input.email, 'email_required', 'An email address is required to sign in.');
  await assertEmailFree(context, email);

  const user: User = {
    id: asUserId(context.services.ids.next('user')),
    firstName,
    lastName,
    initials: deriveInitials(firstName, lastName),
    email,
    mobile: input.mobile.trim(),
    role: input.role,
    jobTitle: input.jobTitle.trim(),
    active: true,
    createdAt: context.services.clock.now(),
  };

  const saved = await context.repos.users.save(user);
  await audit(context, {
    jobId: null,
    type: 'user_created',
    summary: `User added: ${userFullName(saved)}`,
    detail: `${saved.jobTitle || 'Technician'} · ${saved.email}.`,
  });
  return saved;
};

export const updateUser = async (context: OperationContext, user: User): Promise<User> => {
  assertManagesUsers(context);
  const existing = await context.repos.users.findById(user.id);
  if (existing === null) throw new WorkflowError('That user no longer exists.');
  assertManages(context, existing);

  // The role of an existing Master cannot be changed from here either.
  if (existing.role === 'master' && user.role !== 'master') {
    throw new WorkflowError('A Senior Tech account cannot be demoted from here.', [
      { code: 'master_not_editable', message: 'Senior Tech accounts are managed outside this screen.' },
    ]);
  }

  /*
   * A role change is a permission change, so it is held to the same rule as
   * creating an account with that role.
   *
   * Without this, an edit could carry ANY role: the only check was that a
   * Master was not being demoted, so a technician could be saved as a Master —
   * or a Coordinator could promote a technician to Coordinator — simply by
   * passing a different value. A screen that does not offer the option is not
   * what stops that; this is.
   */
  const roleChanged = existing.role !== user.role;

  // Not on your own account, whoever you are. Changing your own permissions is
  // not administration, and a Coordinator who demoted herself would simply lose
  // the office with nobody having decided that.
  if (roleChanged && existing.id === context.actor.id) {
    throw new WorkflowError('You cannot change your own role.', [
      {
        code: 'own_role',
        message: 'A role is set by somebody who administers the account, not by its holder.',
      },
    ]);
  }

  if (roleChanged && !assignableRoles(context.actor.role).includes(user.role)) {
    throw new WorkflowError(
      `${roleLabel(context.actor.role)} accounts cannot make somebody ${roleLabel(user.role) === 'Office' ? 'Office staff' : `a ${roleLabel(user.role)}`}.`,
      [
        {
          code: 'role_not_assignable',
          message: `You can set: ${assignableRoles(context.actor.role)
            .map((role) => roleLabel(role))
            .join(', ')}.`,
        },
      ],
    );
  }

  await assertEmailFree(context, user.email, user.id);

  // PAY-03. The name on the monthly PDFs: upper-case, file-safe; blank means "use the first name".
  const documentName = user.documentName === undefined || user.documentName === null || user.documentName.trim() === ''
    ? null
    : sanitiseDocumentName(user.documentName);
  if (user.documentName !== undefined && user.documentName !== null && user.documentName.trim() !== '' && documentName === '') {
    throw new WorkflowError('That name cannot be used on documents.', [
      { code: 'invalid_document_name', message: 'Use letters or numbers, e.g. JC or RUAN.' },
    ]);
  }
  /*
   * TS-USER-1 (the owner, 8 November 2026): whether this person must keep a timesheet. Set by the Office, or by a Senior
   * Tech on their own account (TS-USER-2, `canSetTimesheetRequired`); it changes nothing else the role may do. Never switched while a timesheet of theirs is half-way — a
   * completed one waiting on My Monthly Forms, or a correction of one open — so no form is left stranded: it is
   * submitted (or withdrawn and its correction completed) first.
   */
  const timesheetRequired = user.timesheetRequired ?? existing.timesheetRequired ?? true;
  const timesheetChanged = timesheetRequired !== (existing.timesheetRequired ?? true);
  if (timesheetChanged) await assertMaySetTimesheetRequired(context, existing, timesheetRequired);
  const saved = await context.repos.users.save({
    ...user,
    timesheetRequired,
    documentName,
    initials:
      user.initials.trim().length > 0
        ? user.initials.trim()
        : deriveInitials(user.firstName, user.lastName),
  });
  await audit(context, {
    jobId: null,
    type: 'user_updated',
    summary: `User updated: ${userFullName(saved)}`,
    detail: `Account details amended by ${userFullName(context.actor)}.`,
  });

  /*
   * A role change is recorded as its own event, saying what it was and what it
   * became. "Account details amended" is not an answer to "who made her a
   * Coordinator, and when?" — and that is the question an administrator will
   * actually be asked.
   */
  if (timesheetChanged) await auditTimesheetRequired(context, saved, timesheetRequired);
  if (roleChanged) {
    await audit(context, {
      jobId: null,
      type: 'user_role_changed',
      summary: `Role changed: ${userFullName(saved)}`,
      detail: `Changed ${userFullName(saved)} from ${roleLabel(existing.role)} to ${roleLabel(saved.role)}, by ${userFullName(context.actor)}.`,
    });
  }
  return saved;
};

/**
 * TS-USER-1: may this actor set this person's "Timesheets required" now? Who (`canSetTimesheetRequired`), and never
 * switched off half-way: not while a completed timesheet (or its correction draft) waits on My Monthly Forms, nor
 * while a correction of a submitted timesheet waits for the office — those are finished first, so nothing is stranded.
 */
const assertMaySetTimesheetRequired = async (context: OperationContext, target: User, required: boolean): Promise<void> => {
  if (!canSetTimesheetRequired(context.actor, target)) {
    throw new WorkflowError(`You cannot change whether ${target.id === context.actor.id ? 'you keep' : `${userFullName(target)} keeps`} a timesheet.`, [
      {
        code: 'timesheet_setting_not_permitted',
        message: 'It is set by the Office for everybody who keeps a timesheet, Senior Techs included; a Senior Tech also sets their own.',
      },
    ]);
  }
  if (required) return;
  // Held as completing and submitting hold them, in the same order: a timesheet completed while this reads cannot slip past it.
  await holdFormLock(context, target.id, 'attendance');
  await holdFormLock(context, target.id, 'timesheet');
  const [forms, drafts, periods] = await Promise.all([
    context.repos.payroll.listFormCompletions(target.id),
    context.repos.payroll.listCorrectionDrafts(target.id),
    context.repos.attendance.listSubmissions(target.id),
  ]);
  const corrections = (await Promise.all(periods.map((period) => context.repos.attendance.listCorrections(period.id)))).flat();
  if (
    forms.some((form) => form.kind === 'timesheet' && formAwaits(form)) ||
    drafts.some((draft) => draft.kind === 'timesheet' && draft.completedId === null) ||
    corrections.some((correction) => correction.status === 'pending')
  ) {
    throw new WorkflowError(`${userFullName(target)} has a timesheet still in progress.`, [
      {
        code: 'timesheet_in_progress',
        message: 'A completed timesheet (or its correction) waits on My Monthly Forms, or a correction of a submitted one waits for the office. Finish it first; then timesheets can be disabled.',
      },
    ]);
  }
};

const auditTimesheetRequired = (context: OperationContext, saved: User, required: boolean) =>
  audit(context, {
    jobId: null,
    type: 'user_updated',
    summary: `Timesheets ${required ? 'required' : 'not required'}: ${userFullName(saved)}`,
    detail: `Timesheets required changed from ${required ? 'Disabled to Enabled' : 'Enabled to Disabled'} for ${userFullName(saved)}, by ${userFullName(context.actor)}.`,
    changes: [{ field: 'Timesheets required', from: required ? 'Disabled' : 'Enabled', to: required ? 'Enabled' : 'Disabled' }],
  });

/** SET "TIMESHEETS REQUIRED" ALONE (TS-USER-1). The same rules as the Users editor; an unchanged value writes nothing. */
export const setTimesheetRequired = async (context: OperationContext, userId: string, required: boolean): Promise<User> => {
  assertManagesUsers(context);
  const existing = await context.repos.users.findById(asUserId(userId));
  if (existing === null) throw new WorkflowError('That user no longer exists.');
  if ((existing.timesheetRequired ?? true) === required) return existing;
  await assertMaySetTimesheetRequired(context, existing, required);
  const saved = await context.repos.users.save({ ...existing, timesheetRequired: required });
  await auditTimesheetRequired(context, saved, required);
  return saved;
};

export const setUserActive = async (
  context: OperationContext,
  user: User,
  active: boolean,
): Promise<User> => {
  assertManagesUsers(context);
  assertManages(context, user);
  if (user.id === context.actor.id && !active) {
    throw new WorkflowError('You cannot disable your own account.', [
      { code: 'self_disable', message: 'Ask another Senior Tech to disable this account.' },
    ]);
  }

  // Disabling is a status change, never a delete: the account keeps its history.
  const saved = await context.repos.users.save({ ...user, active });
  await audit(context, {
    jobId: null,
    type: active ? 'user_reactivated' : 'user_disabled',
    summary: `${active ? 'User reactivated' : 'User disabled'}: ${userFullName(saved)}`,
    detail: active
      ? 'The account can sign in again and appears in the active user list.'
      : 'The account can no longer sign in. Past jobs and audit entries still name this user.',
  });
  return saved;
};

export interface PasswordResetResult {
  readonly user: User;
  readonly sentTo: string;
  readonly simulated: boolean;
}

/**
 * Sends a password-reset link.
 *
 * The demo has no password store, so no password is changed here: the reset
 * email is queued into the simulated outbox exactly as the production system
 * would queue it, and the audit trail records that it was sent.
 */
export const sendPasswordReset = async (
  context: OperationContext,
  user: User,
): Promise<PasswordResetResult> => {
  assertManagesUsers(context);
  assertManages(context, user);
  if (!user.active) {
    throw new WorkflowError('A disabled account cannot be sent a reset link.', [
      { code: 'user_disabled', message: 'Reactivate the account first.' },
    ]);
  }

  await context.services.email.send({
    to: [user.email],
    subject: 'EJE Industrial Electronics — password reset',
    body:
      `Good day ${user.firstName},\n\n` +
      'A password reset was requested for your EJE job card account. ' +
      'Follow the link in this message to choose a new password.\n\n' +
      'Kind regards\nEJE Industrial Electronics',
    attachments: [],
  });

  await audit(context, {
    jobId: null,
    type: 'password_reset_sent',
    summary: `Password reset sent: ${userFullName(user)}`,
    detail: `Reset link queued to ${user.email} by ${userFullName(context.actor)}. Simulated in demo mode.`,
  });

  return { user, sentTo: user.email, simulated: true };
};

