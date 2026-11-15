'use client';

import { useState } from 'react';
import {
  can,
  DEFAULT_COMPANY_ID,
  JOB_TYPE_CODES,
  listJobTypeDefinitions,
  PRIORITY_ORDER,
  priorityLabel,
  type SystemSettings,
} from '@/domain';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Icon,
  LoadingPanel,
  QueryFailure,
  Tabs,
} from '@/components/ui';
import { CompanyAdminPanel } from '@/components/admin/CompanyAdminPanel';
import { PageHeader } from '@/components/layout/PageHeader';
import { AdminNotice } from '@/components/admin/AdminNotice';
import { ChecklistAdminPanel } from '@/components/admin/ChecklistAdminPanel';
import { LibraryAdminPanel } from '@/components/admin/LibraryAdminPanel';
import { UsersPanel } from '@/components/admin/UsersPanel';
import { FinanceRecipientCard } from '@/components/admin/FinanceRecipientCard';
import { EmailTemplatesPanel } from '@/components/admin/EmailTemplatesPanel';
import { IntegrationsPanel } from '@/components/admin/IntegrationsPanel';
import { SIMULATED_CAPABILITIES } from '@/config/demo';
import { useOperation } from '@/hooks/useOperation';
import { demo, reads } from '@/api/endpoints';
import { useQuery } from '@/hooks/useQuery';
import { useCurrentUser } from '@/providers/AppProvider';

type TabId =
  | 'users'
  | 'jobTypes'
  | 'rates'
  | 'checklists'
  | 'library'
  | 'emailTemplates'
  | 'integrations'
  | 'system';

/**
 * Master administration.
 *
 * The purpose of this area in the demonstration is to show management that the
 * things they will want to change — rates, VAT, job types, checklists, users —
 * are configuration, not code. Editing is enabled where it is safe to
 * demonstrate (rates and system settings) and clearly marked as read-only
 * elsewhere.
 */
const AdminPage = () => {
  const user = useCurrentUser();
  const [tab, setTab] = useState<TabId>('users');
  /*
   * MULTI-CO-1: which company Company details and Rates & VAT show — one
   * choice for both, so "Edit rates" on a company's details opens ITS rates.
   */
  const [companyId, setCompanyId] = useState<string>(DEFAULT_COMPANY_ID);

  // Composed on the server, which also refuses a role without `admin.access` —
  // the check below is a courtesy, never the thing that protects the screen.
  const query = useQuery('admin:data', () => reads.admin());

  if (!can(user.role, 'admin.access')) {
    return (
      <EmptyState
        title="Administration is restricted"
        description="System administration is reached by the office."
        icon={<Icon name="settings" />}
      />
    );
  }

  if (query.error !== null) {
    return <QueryFailure code={query.errorCode} message={query.error} onRetry={query.refetch} />;
  }

  const data = query.data;

  /*
   * Which sections this role administers.
   *
   * The office — Master and Coordinator — administers the rates, the checklists,
   * people and the library; the remaining system settings are a Master's. Every
   * operation behind these tabs
   * enforces the same capability itself — this only decides what is worth
   * showing, because a tab that would refuse every action is just a trap.
   */
  const tabs = [
    { id: 'users', label: 'Users' },
    { id: 'jobTypes', label: 'Job Types & Priorities' },
    // The office's, Master and Coordinator — each tab on its own capability, so
    // a tab is only offered to somebody its operations will not refuse.
    ...(can(user.role, 'settings.rates') ? [{ id: 'rates', label: 'Rates & VAT' }] : []),
    ...(can(user.role, 'settings.checklists') ? [{ id: 'checklists', label: 'Checklists' }] : []),
    ...(can(user.role, 'library.manage') ? [{ id: 'library', label: 'Technical Library' }] : []),
    // INT-EMAIL-1 / INT-ADMIN-1: the Master and the Coordinator alike.
    ...(can(user.role, 'emailTemplates.manage') ? [{ id: 'emailTemplates', label: 'Email Templates' }] : []),
    { id: 'integrations', label: 'Integrations' },
    { id: 'system', label: 'System' },
  ];

  return (
    <>
      <PageHeader
        title="Administration"
        breadcrumbs={[{ label: 'Administration' }]}
        description="System configuration. In the production system Senior Techs maintain all of this without developer involvement."
      />

      <Tabs
        tabs={tabs}
        activeId={tab}
        onChange={(id) => setTab(id as TabId)}
        className="mb-5"
      />

      {query.loading || data === null || data === undefined ? (
        <LoadingPanel rows={5} label="Loading administration" />
      ) : (
        <>
          {tab === 'users' && <UsersPanel users={data.users} onChanged={query.refetch} />}
          {tab === 'jobTypes' && <JobTypesPanel />}
          {/* MULTI-CO-1: each company's rates, saved to that company — the one rates editor. */}
          {tab === 'rates' && can(user.role, 'settings.rates') && (
            <CompanyAdminPanel section="rates" companyId={companyId} onCompanyChange={setCompanyId} />
          )}
          {tab === 'checklists' && can(user.role, 'settings.checklists') && (
            <ChecklistAdminPanel
              templates={data.templates}
              usage={data.usage}
              onChanged={query.refetch}
            />
          )}
          {tab === 'library' && can(user.role, 'library.manage') && (
            <LibraryAdminPanel documents={data.documents} onChanged={query.refetch} />
          )}
          {tab === 'emailTemplates' && can(user.role, 'emailTemplates.manage') && <EmailTemplatesPanel />}
          {tab === 'integrations' && <IntegrationsPanel />}
          {tab === 'system' && can(user.role, 'payroll.finance') && (
            <div className="mb-5">
              <FinanceRecipientCard user={user} settings={data.settings} onSaved={query.refetch} />
            </div>
          )}
          {/* MULTI-CO-1: EJE and WD Hearn JHB, each configured on its own. The office's (`settings.rates`). */}
          {tab === 'system' && can(user.role, 'settings.rates') && (
            <div className="mb-5">
              <h2 className="mb-3 text-lg font-semibold text-steel-900">Company details</h2>
              <CompanyAdminPanel
                section="details"
                companyId={companyId}
                onCompanyChange={setCompanyId}
                onOpenRates={() => setTab('rates')}
              />
            </div>
          )}
          {tab === 'system' && (
            <SystemPanel
              companiesAdministered={can(user.role, 'settings.rates')}
              settings={data.settings}
              counts={{
                customers: data.customers.length,
                machines: data.machines.length,
                users: data.users.length,
              }}
            />
          )}
        </>
      )}
    </>
  );
};

const JobTypesPanel = () => (
  <div className="space-y-5">
    <AdminNotice
      title="Job types are behaviour, not labels"
      body="Each job type carries its own requirements. The workflow enforces them, so adding a job type in production is a configuration change rather than new code."
    />

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {listJobTypeDefinitions().map((definition) => (
        <Card key={definition.code}>
          <CardHeader
            title={definition.label}
            description={definition.description}
            action={<Badge tone="outline" size="sm">{definition.code}</Badge>}
          />
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-2.5">
              <Icon
                name={definition.checklistRequired ? 'check' : 'close'}
                className={`size-4 ${definition.checklistRequired ? 'text-verdant-600' : 'text-steel-400'}`}
              />
              <span className="text-steel-700">
                {definition.checklistRequired ? 'Checklist required' : 'No checklist'}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Icon
                name={definition.photosRequired ? 'check' : 'close'}
                className={`size-4 ${definition.photosRequired ? 'text-verdant-600' : 'text-steel-400'}`}
              />
              <span className="text-steel-700">
                {definition.photosRequired ? 'Photographs required' : 'Photographs optional'}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Icon name="warning" className="size-4 text-steel-400" />
              <span className="text-steel-700">
                Default priority: {priorityLabel(definition.defaultPriority)}
              </span>
            </li>
          </ul>
        </Card>
      ))}
    </div>

    <Card>
      <CardHeader
        title="Priorities"
        description="Urgent is deliberately the loudest signal in the system."
      />
      <ul className="mt-4 flex flex-wrap gap-3">
        {PRIORITY_ORDER.map((priority) => (
          <li
            key={priority}
            className="flex items-center gap-2 rounded-[var(--radius-control)] border border-steel-200 px-3 py-2"
          >
            <span className="text-sm font-medium text-steel-800">{priorityLabel(priority)}</span>
            <Badge tone="outline" size="sm">
              {priority}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-steel-500">
        {JOB_TYPE_CODES.length} job types and {PRIORITY_ORDER.length} priorities are defined, as part
        of the system’s reference data. Changing one is a release reviewed with EJE, not a setting.
      </p>
    </Card>
  </div>
);

const SystemPanel = ({
  settings,
  counts,
  companiesAdministered,
}: {
  readonly settings: SystemSettings;
  readonly counts: { customers: number; machines: number; users: number };
  /**
   * MULTI-CO-1: the companies are edited above (Company details), each with its
   * own numbering, so EJE's details and prefix are not repeated read-only here.
   * A role that cannot administer them still sees EJE's, as before.
   */
  readonly companiesAdministered: boolean;
}) => {
  const operation = useOperation();
  const [confirmReset, setConfirmReset] = useState(false);

  const rows = (entries: readonly (readonly [string, string])[]) => (
    <dl className="mt-4 space-y-2.5 text-sm">
      {entries.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b border-steel-100 pb-2">
          <dt className="text-steel-500">{label}</dt>
          <dd className="text-right font-medium break-words text-steel-800">{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {!companiesAdministered && (
          <Card>
            <CardHeader title="Company details" description="EJE, as printed on its job cards." />
            {rows([
              ['Company name', settings.companyName],
              ['Registration number', settings.companyRegistration],
              ['VAT number', settings.companyVatNumber],
              ['Telephone', settings.companyPhone],
              ['Email', settings.companyEmail],
              ['Address', settings.companyAddress],
            ])}
          </Card>
        )}

        <Card>
          <CardHeader title={companiesAdministered ? 'Notifications and records' : 'Job numbering and notifications'} />
          {rows([
            ...(companiesAdministered
              ? []
              : ([
                  ['Job number prefix', settings.jobNumberPrefix],
                  ['Next job number', `${settings.jobNumberPrefix}${settings.nextJobSequence}`],
                ] as const)),
            ['Quiet hours', `${settings.quietHoursStart} – ${settings.quietHoursEnd}`],
            ['Customers on file', String(counts.customers)],
            ['Machines on file', String(counts.machines)],
            ['Users', String(counts.users)],
          ])}
        </Card>
      </div>

      {/* Which build is actually being served. A stale server answering on the
          port looks exactly like missing code; this is how you tell. */}
      <Card>
        <CardHeader
          title="This build"
          description="What the browser is currently being served. If a route 404s that should work, check this first — a previously started server, or a .next directory from an older commit, is the usual cause."
        />
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {[
            // VERSION-1: the release's name, and the commit that identifies it.
            ['Version', process.env.EJE_APP_VERSION === undefined || process.env.EJE_APP_VERSION === 'unknown' ? 'not versioned' : `v${process.env.EJE_APP_VERSION}`],
            ['Commit', process.env.EJE_BUILD_COMMIT ?? 'unknown'],
            ['Built', process.env.EJE_BUILD_TIME ?? 'unknown'],
            ['Mode', process.env.NODE_ENV],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-control)] border border-steel-200 p-3">
              <dt className="text-xs font-semibold tracking-wide text-steel-500 uppercase">
                {label}
              </dt>
              <dd className="mt-1 font-mono text-xs break-all text-steel-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Integrations"
          description="Every integration sits behind a service interface. The real adapters are built; a deployment uses them once configured, and this list says what the demonstration does instead."
        />
        <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {SIMULATED_CAPABILITIES.map((capability) => (
            <li
              key={capability.id}
              className="rounded-[var(--radius-control)] border border-steel-200 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-steel-900">{capability.name}</span>
                <Badge tone="amber" size="sm">
                  Simulated
                </Badge>
              </div>
              <p className="mt-1.5 text-sm text-steel-600">{capability.explanation}</p>
              <p className="mt-1.5 text-xs text-steel-500">
                <span className="font-semibold">In production: </span>
                {capability.productionPlan}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="border-signal-200">
        <CardHeader
          title="Reset demonstration data"
          description="Returns every job, customer and setting to the seeded state. Use this between demonstrations."
          action={
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              Reset demo data
            </Button>
          }
        />
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Reset all demonstration data?"
        message={
          <>
            <p>
              Every change made during this demonstration — accepted jobs, captured labour,
              signatures and submitted job cards — will be discarded and the seeded data restored.
            </p>
            <p className="mt-2 font-semibold text-signal-600">This cannot be undone.</p>
          </>
        }
        confirmLabel="Reset demo data"
        confirmVariant="danger"
        onConfirm={async () => {
          await operation.run(() => demo.reset());
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
};

export default AdminPage;
