'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { can } from '@/domain';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Icon,
  LoadingPanel,
  QueryFailure,
  Tabs,
  type Column,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { NewCustomerDialog } from '@/components/customers/NewCustomerDialog';
import { reads } from '@/api/endpoints';
import { useQuery } from '@/hooks/useQuery';
import { useCurrentUser } from '@/providers/AppProvider';
import {
  COMPANY_CHOICES,
  companyLabel,
  customersForCompany,
} from '@/lib/companies';

interface CustomerRow {
  readonly id: string;
  readonly name: string;
  readonly accountNumber: string;
  readonly industry: string;
  readonly siteCount: number;
  readonly machineCount: number;
  readonly openJobs: number;
  readonly active: boolean;
  readonly companyIds: readonly string[];
}

/** The owner’s tab names (MULTI-CO-1): one tab per company, EJE first. */
const TAB_LABELS: Readonly<Record<string, string>> = {
  eje: 'EJE Customers',
  'wd-hearn-jhb': 'WD Hearn Customers',
};

const CustomersPage = () => {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  /** SITE-2: the customers recorded with several sites before SITE-1. */
  const [legacyOnly, setLegacyOnly] = useState(false);
  /*
   * WHICH COMPANY’S CUSTOMERS. MULTI-CO-1: "EJE Customers" and "WD Hearn
   * Customers"; a customer of both is listed on both. The page always opens on
   * EJE Customers (the default company): a remembered tab made the same page show
   * different controls depending on where a person last clicked (the tablet parity
   * audit, 15 November 2026), and nobody asked for it to be remembered.
   */
  const [company, setCompany] = useState<string>(COMPANY_CHOICES[0]!.id);
  const chooseCompany = (next: string) => {
    setCompany(next);
  };
  // The official customer record belongs to the office, so only a Master adds one.
  const canManage = can(currentUser.role, 'customers.manage');

  const query = useQuery('customers:list', () => reads.customers());

  /*
   * Filtered here, from the one list, rather than a request per tab: the
   * search and the legacy-site filter already work on this list, and switching
   * tabs should not wait for the network. The server’s `?company=` gives the
   * same answer (`customersView`).
   */
  const companyRows = useMemo(() => customersForCompany(query.data ?? [], company), [query.data, company]);
  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return companyRows.filter(
      (row) =>
        (!legacyOnly || row.siteCount > 1) &&
        (needle.length === 0 ||
        row.name.toLowerCase().includes(needle) ||
        row.accountNumber.toLowerCase().includes(needle) ||
        row.industry.toLowerCase().includes(needle)),
    );
  }, [companyRows, term, legacyOnly]);
  const legacyCount = companyRows.filter((row) => row.siteCount > 1).length;

  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      header: 'Customer',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-steel-900">{row.name}</p>
          <p className="truncate font-mono text-xs text-steel-500">{row.accountNumber}</p>
        </div>
      ),
    },
    { key: 'industry', header: 'Industry', secondary: true, render: (row) => row.industry },
    {
      key: 'sites',
      header: 'Sites',
      align: 'right',
      render: (row) =>
        row.siteCount > 1 ? (
          <Badge tone="amber" size="sm">
            {row.siteCount} · legacy
          </Badge>
        ) : (
          <span className="tabular">{row.siteCount}</span>
        ),
    },
    {
      key: 'machines',
      header: 'Machines',
      align: 'right',
      render: (row) => <span className="tabular">{row.machineCount}</span>,
    },
    {
      key: 'openJobs',
      header: 'Open jobs',
      align: 'right',
      render: (row) =>
        row.openJobs === 0 ? (
          <span className="text-steel-400">—</span>
        ) : (
          <Badge tone="blue" size="sm">
            {row.openJobs}
          </Badge>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.active ? 'green' : 'neutral'} size="sm" dot>
          {row.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'chevron',
      header: '',
      align: 'right',
      width: '48px',
      render: () => <Icon name="chevronRight" className="size-4 text-steel-300" />,
    },
  ];

  if (query.error !== null) {
    return <QueryFailure code={query.errorCode} message={query.error} onRetry={query.refetch} />;
  }

  return (
    <>
      <PageHeader
        title="Customers"
        breadcrumbs={[{ label: 'Customers' }]}
        description="Every customer of EJE and of WD Hearn JHB, their sites, machines and open work."
        actions={
          canManage ? (
            <Button
              leadingIcon={<Icon name="plus" className="size-4" />}
              onClick={() => setAdding(true)}
            >
              Add customer
            </Button>
          ) : undefined
        }
      />

      <Tabs
        tabs={COMPANY_CHOICES.map((choice) => ({
          id: choice.id,
          label: TAB_LABELS[choice.id] ?? choice.label,
          badge:
            query.data === null || query.data === undefined ? undefined : (
              <Badge tone="neutral" size="sm">
                {customersForCompany(query.data, choice.id).length}
              </Badge>
            ),
        }))}
        activeId={company}
        onChange={chooseCompany}
        className="mb-5"
      />

      <Card className="mb-5">
        <label htmlFor="customer-search" className="mb-1.5 block text-sm font-semibold text-steel-700">
          Search customers
        </label>
        <div className="relative max-w-lg">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-steel-400"
          />
          <input
            id="customer-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, account number or industry"
            className="h-11 w-full rounded-[var(--radius-control)] border border-steel-300 bg-surface pr-3 pl-10 text-sm placeholder:text-steel-400 hover:border-steel-400 focus:border-eje-500 focus:ring-2 focus:ring-eje-100 focus:outline-none"
          />
        </div>
        {canManage && legacyCount > 0 && (
          <label className="mt-3 flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 text-sm text-steel-700">
            <input
              type="checkbox"
              checked={legacyOnly}
              onChange={(event) => setLegacyOnly(event.target.checked)}
              className="size-5"
              data-testid="legacy-sites-filter"
            />
            Only the {legacyCount} {legacyCount === 1 ? 'customer' : 'customers'} recorded with several
            sites before the one-site rule, to consolidate
          </label>
        )}
      </Card>

      {query.loading ? (
        <LoadingPanel rows={5} label="Loading customers" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/customers/${row.id}`)}
          emptyTitle="No customers found"
          emptyDescription={
            companyRows.length === 0
              ? `No customer is linked to ${companyLabel(company)} yet.`
              : 'No customer matches that search.'
          }
        />
      )}

      {canManage && (
        <NewCustomerDialog
          open={adding}
          onClose={() => setAdding(false)}
          onCreated={(customerId) => {
            setAdding(false);
            query.refetch();
            router.push(`/customers/${customerId}`);
          }}
        />
      )}
    </>
  );
};

export default CustomersPage;
